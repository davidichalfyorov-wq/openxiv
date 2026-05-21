/**
 * OpenXiv Bluesky feed generator.
 *
 * Implements:
 *   - GET /.well-known/did.json — serves the feed-gen's did:web document.
 *   - GET /xrpc/app.bsky.feed.describeFeedGenerator — lists all six feeds.
 *   - GET /xrpc/app.bsky.feed.getFeedSkeleton — returns AT-URIs for a given
 *     feed; the bsky App View hydrates them. Skeletons reference the bridged
 *     `app.bsky.feed.post` URIs (paper_versions.bsky_post_uri), not the
 *     OpenXiv-native paper URIs — bsky only knows how to hydrate its own
 *     lexicon, and the bridge has already published an embed-rich post per
 *     paper.
 *
 * Runs as its own process so it can be deployed behind its own subdomain
 * (e.g. fg.openxiv.net) with its own DID resolution. The DID is configurable
 * via FEED_GENERATOR_DID (default did:web:openxiv.net).
 */
import Fastify from 'fastify';

const PORT = Number.parseInt(process.env['FEED_GENERATOR_PORT'] ?? '4400', 10);
const API_BASE =
  process.env['INTERNAL_API_BASE'] ?? process.env['PUBLIC_API_BASE'] ?? 'http://localhost:4000';
const DID = process.env['FEED_GENERATOR_DID'] ?? 'did:web:openxiv.net';
const SERVICE_ENDPOINT =
  process.env['FEED_GENERATOR_PUBLIC_URL'] ?? `http://localhost:${PORT}`;

const FEED_NAMES = [
  'openxiv-latest',
  'openxiv-featured',
  'openxiv-questions',
  'openxiv-disclosed',
  'openxiv-beginner',
  'openxiv-claims',
] as const;
type FeedName = (typeof FEED_NAMES)[number];

const FEED_DESCRIPTORS: Record<
  FeedName,
  { displayName: string; description: string }
> = {
  'openxiv-latest': {
    displayName: 'OpenXiv — latest',
    description:
      'Every new OpenXiv paper as it lands. Embed cards link to the abstract page.',
  },
  'openxiv-featured': {
    displayName: 'OpenXiv — featured',
    description: 'Editor picks: papers worth your attention right now.',
  },
  'openxiv-questions': {
    displayName: 'OpenXiv — hard questions',
    description: "Papers whose authors pinned a question they couldn't answer.",
  },
  'openxiv-disclosed': {
    displayName: 'OpenXiv — fully disclosed',
    description: 'Papers with primary-author AI disclosure.',
  },
  'openxiv-beginner': {
    displayName: "OpenXiv — explain like I'm new",
    description:
      'Every paper here has a school-level summary you can read in a minute.',
  },
  'openxiv-claims': {
    displayName: 'OpenXiv — claim cards',
    description:
      'Papers shipped with 2+ author claim cards — easy to scan, easy to dispute.',
  },
};

function feedUri(name: FeedName): string {
  return `at://${DID}/app.bsky.feed.generator/${name}`;
}

const app = Fastify({ logger: { level: process.env['LOG_LEVEL'] ?? 'info' } });

/**
 * did:web resolution document. Per the AT-proto spec, a did:web DID resolves
 * to `https://<host>/.well-known/did.json`. The service block declares this
 * process as a Bluesky FeedGenerator so the App View knows where to call
 * getFeedSkeleton.
 */
app.get('/.well-known/did.json', async () => ({
  '@context': ['https://www.w3.org/ns/did/v1'],
  id: DID,
  service: [
    {
      id: '#bsky_fg',
      type: 'BskyFeedGenerator',
      serviceEndpoint: SERVICE_ENDPOINT,
    },
  ],
}));

app.get('/xrpc/app.bsky.feed.describeFeedGenerator', async (_req, reply) => {
  reply.header('cache-control', 'public, max-age=300');
  return {
    did: DID,
    feeds: FEED_NAMES.map((n) => ({
      uri: feedUri(n),
      displayName: FEED_DESCRIPTORS[n].displayName,
      description: FEED_DESCRIPTORS[n].description,
    })),
  };
});

app.get('/xrpc/app.bsky.feed.getFeedSkeleton', async (req, reply) => {
  const { feed, cursor, limit } = (req.query ?? {}) as {
    feed?: string;
    cursor?: string;
    limit?: string;
  };
  if (!feed) {
    reply.status(400);
    return { error: 'InvalidRequest', message: 'feed is required' };
  }
  const name = feedNameFromUri(feed);
  if (!name) {
    reply.status(400);
    return { error: 'UnknownFeed', message: `unknown feed: ${feed}` };
  }
  const params = new URLSearchParams();
  if (limit) params.set('limit', limit);
  if (cursor) params.set('cursor', cursor);
  const url = `${API_BASE}/api/bsky/feeds/${encodeURIComponent(name)}/skeleton?${params.toString()}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(3000),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      req.log.warn({ status: res.status, feed: name }, 'api non-2xx');
      reply.header('cache-control', 'no-store');
      return { feed: [] };
    }
    const data = (await res.json()) as {
      feed: Array<{ post: string }>;
      cursor?: string;
    };
    reply.header('cache-control', 'public, max-age=60');
    return data;
  } catch (err) {
    req.log.warn({ err, feed: name }, 'api unreachable or slow');
    reply.header('cache-control', 'no-store');
    return { feed: [] };
  }
});

app.get('/health', async () => ({ status: 'ok' }));

function feedNameFromUri(uri: string): FeedName | null {
  // bsky calls us with the full at-URI; tolerate both forms.
  if ((FEED_NAMES as readonly string[]).includes(uri)) return uri as FeedName;
  const m = /^at:\/\/[^/]+\/app\.bsky\.feed\.generator\/(?<name>[^/]+)$/.exec(uri);
  const name = m?.groups?.['name'];
  if (name && (FEED_NAMES as readonly string[]).includes(name)) return name as FeedName;
  return null;
}

async function main(): Promise<void> {
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.warn({ signal }, 'feed-generator: shutting down');
    const deadline = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), 10_000).unref(),
    );
    const result = await Promise.race([app.close().then(() => 'ok' as const), deadline]);
    process.exit(result === 'timeout' ? 1 : 0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    app.log.error({ reason }, 'feed-generator unhandledRejection');
  });

  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info(
    { port: PORT, did: DID, feeds: FEED_NAMES.length, apiBase: API_BASE },
    'feed-generator listening',
  );
}

if (process.env['NODE_ENV'] !== 'test') {
  void main();
}

export { feedNameFromUri, FEED_NAMES, FEED_DESCRIPTORS, feedUri, DID, SERVICE_ENDPOINT };
