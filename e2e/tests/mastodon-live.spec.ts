import { expect, test, type APIRequestContext } from '@playwright/test';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { loadLiveEnv, requireProductionOpenXivBaseUrl } from './live-env.js';

const execFileAsync = promisify(execFile);

loadLiveEnv();

const OPENXIV_COOKIE = process.env['E2E_OPENXIV_SESSION_COOKIE'];
const RUN_LIVE = process.env['E2E_MASTODON_LIVE'] === '1';
const SAMPLE_TITLE_PREFIX = 'OpenXiv Mastodon Live E2E';

test.describe('Mastodon live crosspost', () => {
  test('publish crossposts to Mastodon, is idempotent, renders badge, then cleans up', async ({ request }) => {
    test.skip(!RUN_LIVE, 'set E2E_MASTODON_LIVE=1 to run real Mastodon e2e');
    requireProductionOpenXivBaseUrl();
    expect(OPENXIV_COOKIE, 'E2E_OPENXIV_SESSION_COOKIE is required').toBeTruthy();
    expect(process.env['OPENXIV_HOST'], 'OPENXIV_HOST is required to clean up the test preprint').toBeTruthy();
    expect(process.env['OPENXIV_USER'], 'OPENXIV_USER is required to clean up the test preprint').toBeTruthy();

    const cookie = OPENXIV_COOKIE!;
    const meRes = await request.get('/api-proxy/auth/me', { headers: { cookie } });
    expect(meRes.ok(), 'OpenXiv session must be authenticated').toBe(true);
    const me = (await meRes.json()) as {
      authenticated: boolean;
      user: { did: string; id: string; displayName: string };
    };
    expect(me.authenticated).toBe(true);

    const mastodon = await expectLinkedMastodonReady(request, cookie);

    const marker = `${Date.now()}`;
    const title = `${SAMPLE_TITLE_PREFIX} ${marker}`;
    let paperId: string | null = null;
    let openxivUrlId: string | null = null;
    let mastodonStatusId: string | null = null;
    let mastodonStatusUrl: string | null = null;

    try {
      const intake = await request.post('/api-proxy/submissions/intake', {
        headers: { cookie },
        multipart: {
          source: {
            name: 'openxiv-mastodon-live-e2e.tex',
            mimeType: 'application/x-tex',
            buffer: Buffer.from(liveTex(title), 'utf8'),
          },
        },
      });
      expect(intake.ok(), `intake ${intake.status()}: ${await intake.text().catch(() => '')}`).toBe(true);
      const intakeBody = (await intake.json()) as { sessionId: string };
      expect(intakeBody.sessionId).toBeTruthy();

      const finalize = await request.post('/api-proxy/submissions/finalize', {
        headers: { cookie, 'content-type': 'application/json' },
        data: finalizePayload({
          sessionId: intakeBody.sessionId,
          title,
          authorDid: me.user.did,
        }),
      });
      expect(finalize.ok(), `finalize ${finalize.status()}: ${await finalize.text().catch(() => '')}`).toBe(true);
      paperId = ((await finalize.json()) as { paperId: string }).paperId;
      expect(paperId).toBeTruthy();

      const published = await pollPaperForMastodon(request, cookie, paperId!);
      openxivUrlId = published.openxivUrlId;
      mastodonStatusId = published.latestVersion.mastodonStatusId;
      mastodonStatusUrl = published.latestVersion.mastodonStatusUrl;

      expect(openxivUrlId).toMatch(/^physics\.gen-ph\.\d{4}\.\d{5}$/);
      expect(mastodonStatusId, 'Mastodon status id should be recorded').toBeTruthy();
      expect(mastodonStatusUrl, 'Mastodon status URL should be recorded').toMatch(/^https?:\/\//);

      await expectMastodonStatus(request, mastodon.mastodonInstanceUrl, mastodonStatusId!, mastodonStatusUrl!, title, openxivUrlId!);

      const page = await request.get(`/p/${encodeURIComponent(openxivUrlId!)}`);
      expect(page.ok()).toBe(true);
      expect(await page.text()).toContain('Crossposted to Mastodon');

      const retry = await request.post(`/api-proxy/papers/${encodeURIComponent(paperId!)}/retry`, {
        headers: { cookie },
      });
      expect(retry.ok(), `retry ${retry.status()}: ${await retry.text().catch(() => '')}`).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      const reread = await request.get(`/api-proxy/papers/${encodeURIComponent(paperId!)}`, {
        headers: { cookie },
      });
      expect(reread.ok()).toBe(true);
      const retryBody = (await reread.json()) as PaperDetail;
      expect(retryBody.latestVersion.mastodonStatusId).toBe(mastodonStatusId);
    } finally {
      if (me.user.id && mastodonStatusId) await cleanupMastodonStatus(me.user.id, mastodonStatusId);
      if (paperId) await cleanupOpenxivPaper(paperId);
    }
  });
});

interface MastodonLink {
  provider: string;
  subject: string;
  mastodonInstanceUrl: string;
  mastodonAccountUrl?: string | null;
}

interface PaperDetail {
  status: string;
  openxivUrlId: string | null;
  latestVersion: {
    mastodonStatusId: string | null;
    mastodonStatusUrl: string | null;
    mastodonPostStatus: string;
  };
}

async function expectLinkedMastodonReady(request: APIRequestContext, cookie: string): Promise<MastodonLink> {
  const linksRes = await request.get('/api-proxy/me/links', { headers: { cookie } });
  expect(linksRes.ok(), 'linked identity list').toBe(true);
  const links = (await linksRes.json()) as { links: MastodonLink[] };
  const mastodon = links.links.find((l) => l.provider === 'mastodon');
  expect(mastodon?.subject, 'Mastodon account must be linked').toContain('@');
  expect(mastodon?.mastodonInstanceUrl, 'Mastodon account must have an instance URL').toMatch(/^https?:\/\//);
  return mastodon!;
}

async function pollPaperForMastodon(request: APIRequestContext, cookie: string, paperId: string): Promise<PaperDetail> {
  let last: PaperDetail | null = null;
  for (let i = 0; i < 120; i += 1) {
    const res = await request.get(`/api-proxy/papers/${encodeURIComponent(paperId)}`, {
      headers: { cookie },
    });
    if (res.ok()) {
      last = (await res.json()) as PaperDetail;
      if (
        last.status === 'published' &&
        last.openxivUrlId &&
        last.latestVersion?.mastodonStatusId
      ) {
        return last;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`paper did not reach Mastodon-posted state: ${JSON.stringify(last)}`);
}

async function expectMastodonStatus(
  request: APIRequestContext,
  instanceUrl: string,
  statusId: string,
  statusUrl: string,
  title: string,
  openxivUrlId: string,
): Promise<void> {
  const api = await request.get(`${instanceUrl.replace(/\/$/, '')}/api/v1/statuses/${encodeURIComponent(statusId)}`, {
    headers: { accept: 'application/json' },
  });
  if (api.ok()) {
    const body = (await api.json()) as { content?: string; url?: string };
    expect(`${body.content ?? ''} ${body.url ?? ''}`).toContain(openxivUrlId);
    expect(`${body.content ?? ''} ${body.url ?? ''}`).toContain(title.slice(0, 80));
    return;
  }
  const html = await request.get(statusUrl);
  expect(html.ok(), `Mastodon status URL should be readable; got ${html.status()}`).toBe(true);
  expect(await html.text()).toContain(openxivUrlId);
}

async function cleanupMastodonStatus(userId: string, mastodonStatusId: string): Promise<void> {
  if (!process.env['OPENXIV_HOST'] || !process.env['OPENXIV_USER']) {
    throw new Error('OPENXIV_HOST and OPENXIV_USER are required to clean up the Mastodon status');
  }
  const scriptPath = path.resolve(process.cwd(), '..', 'scripts', 'ssh_run.py');
  const remote = `
set -e
cd /opt/openxiv
DC="docker compose -f docker-compose.yml -f docker-compose.production.yml"
ROW="$($DC exec -T postgres psql -U openxiv -d openxiv -At -F '|' -c "select coalesce(mastodon_instance_url,''), coalesce(mastodon_access_token,'') from account_links where user_id='${userId}' and provider='mastodon' limit 1;")"
INSTANCE="\${ROW%%|*}"
TOKEN="\${ROW#*|}"
if [ -n "$INSTANCE" ] && [ -n "$TOKEN" ]; then
  $DC exec -T -e MASTODON_INSTANCE_URL="$INSTANCE" -e MASTODON_ACCESS_TOKEN="$TOKEN" -e MASTODON_STATUS_ID="${mastodonStatusId}" api node --input-type=module <<'NODE'
const base = process.env.MASTODON_INSTANCE_URL?.replace(/\\/$/, '');
const token = process.env.MASTODON_ACCESS_TOKEN;
const id = process.env.MASTODON_STATUS_ID;
if (!base || !token || !id) process.exit(0);
const res = await fetch(base + '/api/v1/statuses/' + encodeURIComponent(id), {
  method: 'DELETE',
  headers: { authorization: 'Bearer ' + token, accept: 'application/json' },
});
if (!res.ok && res.status !== 404) {
  const text = await res.text().catch(() => '');
  throw new Error('Mastodon status cleanup failed ' + res.status + ': ' + text.slice(0, 200));
}
console.log('mastodon_status_cleanup|' + res.status);
NODE
fi
`;
  await execFileAsync('python', [scriptPath, 'exec', '--', remote], {
    env: process.env,
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
}

async function cleanupOpenxivPaper(paperId: string): Promise<void> {
  if (!process.env['OPENXIV_HOST'] || !process.env['OPENXIV_USER']) {
    throw new Error('OPENXIV_HOST and OPENXIV_USER are required to clean up the test preprint');
  }
  const scriptPath = path.resolve(process.cwd(), '..', 'scripts', 'ssh_run.py');
  const remote = `
set -e
cd /opt/openxiv
DC="docker compose -f docker-compose.yml -f docker-compose.production.yml"
VERSION_IDS="$($DC exec -T postgres psql -U openxiv -d openxiv -At -F ',' -c "select string_agg(id::text, ',') from paper_versions where paper_id='${paperId}';")"
$DC exec -T api sh -lc 'cd /app/packages/clients && PAPER_ID="${paperId}" node --input-type=module <<'"'"'NODE'"'"'
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || "auto",
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
  forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || "true") !== "false",
});
let token;
do {
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: \`papers/\${process.env.PAPER_ID}/\`, ContinuationToken: token }));
  const objects = (listed.Contents || []).map((x) => ({ Key: x.Key })).filter((x) => x.Key);
  if (objects.length) await s3.send(new DeleteObjectsCommand({ Bucket: process.env.S3_BUCKET, Delete: { Objects: objects } }));
  token = listed.NextContinuationToken;
} while (token);
NODE'
$DC exec -T api sh -lc 'cd /app/apps/api && PAPER_ID="${paperId}" VERSION_IDS="'"$VERSION_IDS"'" node --input-type=module <<'"'"'NODE'"'"'
import { Job, Queue } from "bullmq";
import IORedis from "ioredis";
const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const versionIds = (process.env.VERSION_IDS || "").split(",").filter(Boolean);
const ids = new Set([\`saga-\${process.env.PAPER_ID}\`]);
for (const versionId of versionIds) {
  ids.add(\`pdf-finalize-\${versionId}\`);
  ids.add(\`mastodon-crosspost-\${versionId}\`);
}
for (const queueName of ["openxiv.compile", "openxiv.pdf-finalize", "openxiv.mastodon-crosspost"]) {
  const queue = new Queue(queueName, { connection });
  for (const id of ids) {
    const job = await Job.fromId(queue, id);
    if (job) { try { await job.remove(); } catch {} }
  }
  await queue.close();
}
await connection.quit();
NODE'
$DC exec -T postgres psql -U openxiv -d openxiv -v ON_ERROR_STOP=1 -c "delete from papers where id='${paperId}';"
`;
  await execFileAsync('python', [scriptPath, 'exec', '--', remote], {
    env: process.env,
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
}

function finalizePayload(input: {
  sessionId: string;
  title: string;
  authorDid: string;
}) {
  return {
    sessionId: input.sessionId,
    title: input.title,
    abstract:
      'Temporary live e2e manuscript verifying Mastodon crossposting from the production OpenXiv flow.',
    license: 'CC-BY-4.0',
    primaryCategory: 'physics.gen-ph',
    crossListings: [],
    authors: [
      {
        displayName: 'OpenXiv Mastodon E2E',
        did: input.authorDid,
        affiliation: 'OpenXiv verification',
        isCorresponding: true,
      },
    ],
    keywords: ['OpenXiv', 'Mastodon', 'live-e2e'],
    disclosure: {
      level: 'none',
      aiUsed: [],
      models: [],
      summaryAiGenerated: false,
      attestation: 'i-attest-this-disclosure-is-accurate',
    },
    summary: {
      tier: 'undergrad',
      text:
        'This temporary live test preprint verifies that OpenXiv can publish a preprint and crosspost it to Mastodon. It is not a scientific contribution and is deleted after the test finishes.',
      aiGenerated: false,
    },
    submissionTerms: {
      version: 'v1',
      attestation: 'i-accept-openxiv-submission-terms-v1',
    },
  };
}

function liveTex(title: string): string {
  return `\\documentclass{article}
\\title{${title}}
\\author{OpenXiv Mastodon E2E}
\\begin{document}
\\maketitle
\\begin{abstract}
Temporary live e2e manuscript verifying Mastodon crossposting from the production OpenXiv flow.
\\end{abstract}
\\section{Smoke}
This controlled test document contains enough text for the production intake and compile pipeline. It is deleted after verification.
\\end{document}
`;
}
