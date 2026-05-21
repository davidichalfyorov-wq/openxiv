import WebSocket from 'ws';
import type { Logger } from 'pino';
import type { AppContext } from '../context.js';
import { isFeatureEnabled } from './flags.js';

/**
 * Bluesky jetstream consumer. Subscribes to the public firehose endpoint
 * (`wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post`)
 * and surfaces every post that references an OpenXiv paper into the local
 * `posts` table with `label='bsky-mention'`. The /abs/{id} page reads from
 * the posts table to populate the Seminar Thread block.
 *
 * Resilience:
 *   - Exponential backoff on disconnect (max 60s).
 *   - Persists the latest `time_us` cursor in Redis so a restart picks up
 *     from where it stopped (with a fixed look-back to absorb missed events
 *     during downtime).
 *   - Feature-flag gated — `bluesky_jetstream` toggles the worker off without
 *     a redeploy.
 *   - Dedup is enforced at the DB layer via `posts_uri_idx` unique index.
 *
 * Filter rules:
 *   - Text contains `openxiv.net/abs/`
 *   - OR a facet feature has `app.bsky.richtext.facet#link` with that URI
 *   - OR the record contains `openxiv:<digits>` token (legacy direct mention)
 */

const JETSTREAM_URL_DEFAULT = 'wss://jetstream2.us-east.bsky.network/subscribe';
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 60_000;
const CURSOR_LOOK_BACK_US = 5_000_000; // 5 seconds in microseconds
const CURSOR_REDIS_KEY = 'bsky:jetstream:cursor';
const POST_FILTER_RE = /(openxiv\.net\/abs\/[\w.+-]+|openxiv:[a-z][\w.+-]*\.\d{4}\.\d{5,6})/i;

export interface JetstreamMessage {
  did: string;
  time_us: number;
  kind: 'commit';
  commit?: {
    rev?: string;
    operation: 'create' | 'update' | 'delete';
    collection: string;
    rkey: string;
    record?: BskyFeedPost;
    cid?: string;
  };
}

interface BskyFeedPost {
  $type?: string;
  text: string;
  createdAt?: string;
  langs?: string[];
  facets?: Array<{
    features: Array<{ $type: string; uri?: string; tag?: string }>;
  }>;
  embed?: {
    $type?: string;
    external?: { uri: string };
  };
  reply?: {
    root?: { uri: string };
    parent?: { uri: string };
  };
}

export interface JetstreamSubscriber {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Inspect current connection state for `/healthz` reporting. */
  status(): { connected: boolean; lastCursor: number | null; lastEventAt: number | null };
}

export interface JetstreamConfig {
  readonly url?: string;
  readonly labelerDid: string;
  readonly logger?: Logger;
}

export function makeJetstreamSubscriber(
  ctx: AppContext,
  cfg: JetstreamConfig,
): JetstreamSubscriber {
  const url = cfg.url ?? JETSTREAM_URL_DEFAULT;
  const log = cfg.logger ?? (console as unknown as Logger);
  let ws: WebSocket | null = null;
  let stopping = false;
  let lastCursor: number | null = null;
  let lastEventAt: number | null = null;
  let reconnectAttempts = 0;
  let reconnectTimer: NodeJS.Timeout | null = null;

  async function loadCursor(): Promise<number | null> {
    try {
      const raw = await ctx.redis.get(CURSOR_REDIS_KEY);
      if (!raw) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  async function saveCursor(cursor: number): Promise<void> {
    try {
      await ctx.redis.set(CURSOR_REDIS_KEY, String(cursor));
    } catch {
      // best-effort
    }
  }

  async function buildSubscribeUrl(): Promise<string> {
    const params = new URLSearchParams();
    params.append('wantedCollections', 'app.bsky.feed.post');
    const stored = await loadCursor();
    if (stored !== null) {
      params.set('cursor', String(Math.max(0, stored - CURSOR_LOOK_BACK_US)));
    }
    return `${url}?${params.toString()}`;
  }

  async function connect(): Promise<void> {
    if (stopping) return;
    const fullUrl = await buildSubscribeUrl();
    log.info({ url: fullUrl }, '[jetstream] connecting');
    const sock = new WebSocket(fullUrl);
    ws = sock;
    sock.on('open', () => {
      reconnectAttempts = 0;
      log.info('[jetstream] connected');
    });
    sock.on('message', (data) => {
      void handleMessage(data.toString());
    });
    sock.on('error', (err) => {
      log.warn({ err: err.message }, '[jetstream] socket error');
    });
    sock.on('close', (code) => {
      log.warn({ code }, '[jetstream] disconnected');
      ws = null;
      if (!stopping) scheduleReconnect();
    });
  }

  function scheduleReconnect(): void {
    if (stopping) return;
    if (reconnectTimer) return;
    const delay = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_BASE_MS * 2 ** Math.min(8, reconnectAttempts),
    );
    reconnectAttempts += 1;
    log.info({ delay, attempt: reconnectAttempts }, '[jetstream] reconnecting');
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
    reconnectTimer.unref?.();
  }

  async function handleMessage(raw: string): Promise<void> {
    let msg: JetstreamMessage;
    try {
      msg = JSON.parse(raw) as JetstreamMessage;
    } catch {
      return;
    }
    if (msg.time_us) {
      lastCursor = msg.time_us;
      lastEventAt = Date.now();
      // Persist cursor sparsely — every ~50 events — to keep Redis writes flat.
      if (msg.time_us % 50 === 0) {
        void saveCursor(msg.time_us);
      }
    }
    if (msg.kind !== 'commit' || !msg.commit) return;
    if (msg.commit.collection !== 'app.bsky.feed.post') return;
    if (msg.commit.operation !== 'create') return;
    const record = msg.commit.record;
    if (!record || typeof record.text !== 'string') return;

    if (!isOpenxivMention(record)) return;

    const postUri = `at://${msg.did}/app.bsky.feed.post/${msg.commit.rkey}`;
    const matched = matchedOpenxivId(record);
    if (!matched) return;

    // Best-effort: enqueue side effects but never throw out of the message
    // handler — a poisonous record must not stall the whole stream.
    try {
      await Promise.allSettled([
        ctx.repos.posts.create({
          uri: postUri,
          cid: msg.commit.cid ?? null,
          authorDid: msg.did,
          text: record.text.slice(0, 2000),
          replyRootUri: record.reply?.root?.uri ?? null,
          replyParentUri: record.reply?.parent?.uri ?? null,
          embedPaperUri: matched.openxivAbsUrl,
          embedExternal: record.embed?.external
            ? { uri: record.embed.external.uri, title: '' }
            : null,
          tags: null,
          langs: record.langs ?? null,
          label: 'bsky-mention',
        }),
        ctx.repos.bskyLabels.apply({
          src: cfg.labelerDid,
          uri: postUri,
          ...(msg.commit.cid ? { cid: msg.commit.cid } : {}),
          val: 'openxiv-paper',
        }),
      ]);
    } catch (err) {
      log.warn({ err: (err as Error).message, postUri }, '[jetstream] side-effect failure');
    }
  }

  return {
    async start() {
      if (!(await isFeatureEnabled(ctx, 'bluesky_jetstream', false))) {
        log.info('[jetstream] feature flag off; not starting');
        return;
      }
      stopping = false;
      await connect();
    },
    async stop() {
      stopping = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        try {
          ws.close(1000, 'shutdown');
        } catch {
          // ignore
        }
        ws = null;
      }
      if (lastCursor !== null) await saveCursor(lastCursor);
    },
    status() {
      return {
        connected: ws?.readyState === WebSocket.OPEN,
        lastCursor,
        lastEventAt,
      };
    },
  };
}

/**
 * Detects whether an `app.bsky.feed.post` record references an OpenXiv paper.
 * Exported for tests.
 */
export function isOpenxivMention(record: BskyFeedPost): boolean {
  if (POST_FILTER_RE.test(record.text)) return true;
  if (record.embed?.external?.uri && POST_FILTER_RE.test(record.embed.external.uri)) return true;
  if (record.facets) {
    for (const f of record.facets) {
      for (const feat of f.features) {
        if (feat.uri && POST_FILTER_RE.test(feat.uri)) return true;
      }
    }
  }
  return false;
}

/**
 * Extract the openxiv abs URL or id token from a matching post. Returns null
 * if nothing matched (caller should have run `isOpenxivMention` first).
 * Exported for tests.
 */
export function matchedOpenxivId(record: BskyFeedPost): { openxivAbsUrl: string } | null {
  const candidates: string[] = [record.text];
  if (record.embed?.external?.uri) candidates.push(record.embed.external.uri);
  if (record.facets) {
    for (const f of record.facets) {
      for (const feat of f.features) {
        if (feat.uri) candidates.push(feat.uri);
      }
    }
  }
  for (const c of candidates) {
    const m = c.match(POST_FILTER_RE);
    if (m) {
      const token = m[1]!;
      if (token.startsWith('openxiv.net/')) {
        return { openxivAbsUrl: `https://${token}` };
      }
      // openxiv:id form — synthesise the abs URL.
      const id = token.slice('openxiv:'.length);
      return { openxivAbsUrl: `https://openxiv.net/abs/${id}` };
    }
  }
  return null;
}

export const __testing = { POST_FILTER_RE, RECONNECT_BASE_MS, RECONNECT_MAX_MS };
