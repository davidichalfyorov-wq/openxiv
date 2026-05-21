import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type Request } from '@playwright/test';
import { SignJWT } from 'jose';
import pg from 'pg';

const ALTMETRIC_HOST_RE = /^(https?:\/\/)?(.*\.)?(altmetric\.com|d1bxh8uas1mnw7\.cloudfront\.net)\b/i;
const BASE_URL = process.env['E2E_BASE_URL'] ?? 'http://localhost:4321';
const SUPPLIED_PAPER_PATH = process.env['E2E_ENGAGEMENT_PAPER_PATH'];
const REPO_ROOT = findRepoRoot();
const API_BASE = (process.env['E2E_API_BASE'] ?? envValue('PUBLIC_API_BASE') ?? 'http://localhost:4000').replace(/\/$/, '');

const { Pool } = pg;
let paperPath = SUPPLIED_PAPER_PATH ?? '';
let seededPaper: SeededPaper | null = null;

interface CapturedRequest {
  url: string;
  method: string;
  resourceType: string;
}

interface SeededPaper {
  id: string;
  path: string;
  targetUri: string;
  expected: {
    endorsements: number;
    views: number;
    htmlOpens: number;
    pdfDownloads: number;
  };
}

function spyAltmetric(page: Page): { requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  page.on('request', (req: Request) => {
    if (ALTMETRIC_HOST_RE.test(req.url())) {
      requests.push({ url: req.url(), method: req.method(), resourceType: req.resourceType() });
    }
  });
  return { requests };
}

function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function envValue(name: string): string | undefined {
  const direct = process.env[name];
  if (direct) return direct;
  for (const file of [path.join(REPO_ROOT, 'apps/api/.env'), path.join(REPO_ROOT, '.env')]) {
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const match = /^([^#=\s]+)\s*=\s*(.*)$/.exec(line);
      if (!match || match[1] !== name) continue;
      return match[2]?.trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return undefined;
}

async function signTestSession(secret: string, user: { id: string; did: string; role: string }): Promise<string> {
  return new SignJWT({ uid: user.id, did: user.did, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 30 * 60)
    .sign(new TextEncoder().encode(secret));
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function paperSlug(): string {
  return paperPath.replace(/^\/p\//, '');
}

async function getEngagementJson(page: Page): Promise<{
  endorsements: { count: number };
  reads: { views: number; html_opens: number; pdf_downloads: number };
}> {
  const url = `${API_BASE}/api/papers/${encodeURIComponent(paperSlug())}/engagement`;
  let lastStatus = 0;
  let lastBody = '';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const res = await page.request.get(url);
    lastStatus = res.status();
    lastBody = await res.text();
    if (res.ok()) {
      return JSON.parse(lastBody) as {
        endorsements: { count: number };
        reads: { views: number; html_opens: number; pdf_downloads: number };
      };
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`engagement endpoint did not become ready: ${url} status=${lastStatus} body=${lastBody.slice(0, 500)}`);
}

async function gotoPaperWithEngagement(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.goto(`${paperPath}?e2e_engagement=${Date.now()}-${attempt}`);
    if ((await page.getByTestId('engagement-badge').count()) > 0) return;
    await page.waitForTimeout(300);
  }
  await expect(page.getByTestId('engagement-badge')).toBeVisible();
}

async function seedEngagementPaper(pool: InstanceType<typeof Pool>): Promise<SeededPaper> {
  const seq = String(Math.floor(10_000 + Math.random() * 90_000)).padStart(5, '0');
  const openxivId = `openxiv:physics.2026.${seq}`;
  const targetUri = `at://did:plc:e2e-engagement-fixture/app.openxiv.paper/${seq}`;
  const doi = `10.5555/openxiv-engagement-${seq}`;

  const paper = await pool.query<{ id: string }>(
    `INSERT INTO papers
      (openxiv_id, uri, submitter_did, title, abstract, license, primary_category, doi, status, published_at)
     VALUES
      ($1, $2, 'did:plc:e2e-submit-engagement', 'Engagement badge e2e fixture',
       'Fixture paper for the engagement badge end-to-end test.', 'CC-BY-4.0', 'physics',
       $3, 'published', now())
     RETURNING id`,
    [openxivId, targetUri, doi],
  );
  const paperId = paper.rows[0]?.id;
  if (!paperId) throw new Error('failed to seed engagement paper');

  await pool.query(
    `INSERT INTO paper_authors (paper_id, position, did, display_name, affiliation, is_corresponding)
     VALUES ($1::uuid, 1, 'did:plc:e2e-submit-engagement', 'Engagement Fixture', 'OpenXiv E2E', true)`,
    [paperId],
  );
  await pool.query(
    `INSERT INTO endorsements (uri, paper_id, endorser_did, verb, note)
     VALUES
      ($1, $2::uuid, 'did:plc:e2e-alice', 'verified_derivation', 'checked'),
      ($3, $2::uuid, 'did:plc:e2e-bob', 'reproduced_result', null)`,
    [`at://did:plc:e2e-alice/endorse/${seq}`, paperId, `at://did:plc:e2e-bob/endorse/${seq}`],
  );
  await pool.query(
    `INSERT INTO feed_events (session_id, event_type, target_uri, target_type, context_json)
     VALUES
      ($2, 'paper_view', $1, 'openxiv_paper', '{}'::jsonb),
      ($3, 'paper_view', $1, 'openxiv_paper', '{}'::jsonb),
      ($4, 'html_open', $1, 'openxiv_paper', '{}'::jsonb),
      ($5, 'pdf_download', $1, 'openxiv_paper', '{}'::jsonb)`,
    [targetUri, `e2e-engagement-${seq}-view-a`, `e2e-engagement-${seq}-view-b`, `e2e-engagement-${seq}-html`, `e2e-engagement-${seq}-pdf`],
  );

  return {
    id: paperId,
    path: `/p/${paperId}`,
    targetUri,
    expected: {
      endorsements: 2,
      views: 2,
      htmlOpens: 1,
      pdfDownloads: 1,
    },
  };
}

async function cleanupSeededPaper(pool: InstanceType<typeof Pool>, paper: SeededPaper): Promise<void> {
  await pool.query('DELETE FROM feed_events WHERE target_uri = $1', [paper.targetUri]).catch(() => undefined);
  await pool.query('DELETE FROM papers WHERE id = $1::uuid', [paper.id]).catch(() => undefined);
}

test.describe('Engagement badge and Altmetric opt-in', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!SUPPLIED_PAPER_PATH && !envValue('DATABASE_URL'), 'DATABASE_URL or E2E_ENGAGEMENT_PAPER_PATH is required');

  test.beforeAll(async () => {
    if (paperPath) return;
    const databaseUrl = envValue('DATABASE_URL');
    if (!databaseUrl) return;
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    try {
      seededPaper = await seedEngagementPaper(pool);
      paperPath = seededPaper.path;
    } finally {
      await pool.end().catch(() => undefined);
    }
  });

  test.afterAll(async () => {
    if (!seededPaper) return;
    const databaseUrl = envValue('DATABASE_URL');
    if (!databaseUrl) return;
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    try {
      await cleanupSeededPaper(pool, seededPaper);
    } finally {
      await pool.end().catch(() => undefined);
    }
  });

  test('self-built engagement badge is visible before any Altmetric request', async ({ page }) => {
    const { requests } = spyAltmetric(page);
    const engagement = await getEngagementJson(page);
    await gotoPaperWithEngagement(page);

    await expect(page.getByTestId('engagement-badge')).toBeVisible();
    await expect(page.getByTestId('engagement-endorsements')).toBeVisible();
    await expect(page.getByTestId('engagement-citations')).toBeVisible();
    await expect(page.getByTestId('engagement-reads')).toBeVisible();
    await expect(page.getByTestId('engagement-endorsements').locator('.engagement-value')).toHaveText(
      compactNumber(engagement.endorsements.count),
    );
    await expect(page.getByTestId('engagement-reads')).toContainText(
      `${compactNumber(engagement.reads.views)} views · ${compactNumber(engagement.reads.html_opens)} html · ${compactNumber(engagement.reads.pdf_downloads)} pdf`,
    );
    if (seededPaper) {
      expect(engagement.endorsements.count).toBe(seededPaper.expected.endorsements);
      expect(engagement.reads).toEqual({
        views: seededPaper.expected.views,
        html_opens: seededPaper.expected.htmlOpens,
        pdf_downloads: seededPaper.expected.pdfDownloads,
      });
    }
    await expect(requests, `unexpected pre-consent Altmetric traffic: ${requests.map((r) => r.url).join(', ')}`).toEqual([]);
  });

  test('Show once opt-in loads Altmetric only after explicit consent', async ({ page }) => {
    const { requests } = spyAltmetric(page);
    await gotoPaperWithEngagement(page);
    await expect(requests).toEqual([]);

    await page.getByRole('button', { name: /show alt-metrics/i }).click();
    await expect(page.getByText(/Loading Altmetric shares DOI/)).toBeVisible();
    await expect(requests).toEqual([]);

    await page.getByRole('button', { name: /show once/i }).click();
    await expect(page.locator('.altmetric-embed, .altmetric-donut')).toBeVisible({ timeout: 15_000 });
    expect(
      requests.some((r) => ALTMETRIC_HOST_RE.test(r.url)),
      `no Altmetric request captured after opt-in: ${requests.map((r) => r.url).join(', ')}`,
    ).toBe(true);
  });

  test('DNT disables Altmetric opt-in and emits zero Altmetric requests', async ({ browser }) => {
    const ctx = await browser.newContext({
      extraHTTPHeaders: { DNT: '1' },
      javaScriptEnabled: true,
    });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'doNotTrack', { configurable: true, get: () => '1' });
    });
    const page = await ctx.newPage();
    const { requests } = spyAltmetric(page);

    await gotoPaperWithEngagement(page);
    const toggle = page.getByRole('button', { name: /show alt-metrics/i });
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveAttribute('title', /Do Not Track/i);
    await page.waitForTimeout(800);
    expect(requests, `DNT leaked Altmetric traffic: ${requests.map((r) => r.url).join(', ')}`).toEqual([]);
    await ctx.close();
  });

  test('endorsement API mutation invalidates cache and updates badge after reload', async ({ page }) => {
    const databaseUrl = envValue('DATABASE_URL');
    const sessionSecret = envValue('SESSION_SECRET');
    test.skip(!databaseUrl || !sessionSecret, 'DATABASE_URL and SESSION_SECRET are required for real endorsement e2e');

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const did = `did:plc:e2e-engagement-${randomUUID()}`;
    const handle = `e2e-engagement-${randomUUID().slice(0, 8)}.test`;
    const verb = 'useful_background';
    const note = `e2e engagement ${randomUUID()}`;
    const paperParam = encodeURIComponent(paperSlug());

    try {
      const inserted = await pool.query<{ id: string; did: string; role: string }>(
        `INSERT INTO users (did, handle, display_name, role)
         VALUES ($1, $2, 'Engagement E2E', 'author')
         RETURNING id, did, role`,
        [did, handle],
      );
      const user = inserted.rows[0];
      if (!user || !sessionSecret) throw new Error('failed to create e2e user');

      const token = await signTestSession(sessionSecret, user);
      await page.context().addCookies([
        {
          name: 'openxiv_session',
          value: token,
          url: BASE_URL,
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);

      const before = await getEngagementJson(page);

      await gotoPaperWithEngagement(page);
      await expect(page.getByTestId('engagement-endorsements').locator('.engagement-value')).toHaveText(
        compactNumber(before.endorsements.count),
      );

      const postRes = await page.request.post(`${API_BASE}/api/papers/${paperParam}/endorsements`, {
        data: { verb, note },
      });
      expect(postRes.ok(), await postRes.text()).toBe(true);

      await page.reload();
      await expect(page.getByTestId('engagement-endorsements').locator('.engagement-value')).toHaveText(
        compactNumber(before.endorsements.count + 1),
      );
      await expect(page.getByTestId('engagement-endorsements')).toContainText('Useful Background');
    } finally {
      await page.request.delete(`${API_BASE}/api/papers/${paperParam}/endorsements/mine`).catch(() => undefined);
      await pool.query('DELETE FROM endorsements WHERE endorser_did = $1', [did]).catch(() => undefined);
      await pool.query('DELETE FROM users WHERE did = $1', [did]).catch(() => undefined);
      await pool.end().catch(() => undefined);
    }
  });
});
