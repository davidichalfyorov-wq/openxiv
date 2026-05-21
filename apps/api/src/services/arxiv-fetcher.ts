/**
 * arXiv fetcher (P1 #3 OpenXiv Lens).
 *
 * Fetches metadata for a single arXiv paper by id via the public ATOM API at
 *   http://export.arxiv.org/api/query?id_list={id}
 *
 * arXiv's terms cap us at one request per 3 seconds. We enforce that with a
 * Redis-backed token bucket (`arxiv:rate:last`) — concurrent callers across
 * the api/worker fleet block until at least 3s after the previous request.
 *
 * Parsing avoids a generic XML library on purpose: arXiv ATOM is a very
 * narrow shape and a small regex parser is enough, plus it has zero
 * native-dependency risk.
 */
import type { ExternalAuthor, NewExternalPaper } from '@openxiv/db';
import { fetchWithTimeoutRetry } from '@openxiv/clients';
import type { AppContext } from '../context.js';

const ARXIV_BASE = 'https://export.arxiv.org/api/query';
const RATE_KEY = 'arxiv:rate:last';
const MIN_INTERVAL_MS = 3000;
const FETCH_TIMEOUT_MS = 10_000;

export interface ArxivFetchResult {
  paper: NewExternalPaper;
  /** True if the upstream response indicated this paper was withdrawn. */
  withdrawn: boolean;
  /** Raw ATOM XML for audit (truncated). */
  raw: string;
}

export interface ArxivFetcher {
  fetchById(id: string): Promise<ArxivFetchResult | null>;
}

export function makeArxivFetcher(ctx: AppContext): ArxivFetcher {
  const redis = ctx.redis;

  async function waitTurn(): Promise<void> {
    const now = Date.now();
    let last = 0;
    try {
      const raw = await redis.get(RATE_KEY);
      last = raw ? Number.parseInt(raw, 10) : 0;
    } catch {
      // Redis down → don't deadlock; we honour the rate locally with a
      // small sleep instead. Worst case a single replica burst-hits arXiv.
      await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS));
      return;
    }
    const wait = last + MIN_INTERVAL_MS - now;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      await redis.set(RATE_KEY, String(Date.now()), 'EX', 60);
    } catch {
      // ignore
    }
  }

  return {
    async fetchById(id) {
      // Accept either the bare arxiv id (e.g. 2308.12345) or arxiv:2308.12345.
      const cleanId = id.replace(/^arxiv:/i, '').trim();
      if (!/^[A-Za-z0-9.\-/]+$/.test(cleanId) || cleanId.length > 64) return null;
      await waitTurn();
      const url = `${ARXIV_BASE}?id_list=${encodeURIComponent(cleanId)}`;
      const res = await fetchWithTimeoutRetry(url, {
        timeoutMs: FETCH_TIMEOUT_MS,
        headers: { 'user-agent': 'OpenXiv-Lens/0.1 (https://openxiv.net)' },
      });
      if (!res.ok) return null;
      const xml = await res.text();
      const parsed = parseArxivAtom(xml, cleanId);
      if (!parsed) return null;
      return { paper: parsed.paper, withdrawn: parsed.withdrawn, raw: xml.slice(0, 20_000) };
    },
  };
}

/**
 * Parse a single-entry arXiv ATOM response. Exported for unit tests so we
 * don't need to round-trip through HTTP.
 *
 * Edge cases handled:
 *   - Empty <entry> ⇒ returns null (paper not in arXiv).
 *   - Withdrawn paper ⇒ withdrawn=true, title/abstract may be empty.
 *   - Missing <summary> ⇒ abstract=null.
 *   - Multiple authors ⇒ all collected in order.
 *   - Categories: primary first (from `<arxiv:primary_category term=…>`), then secondaries.
 */
export function parseArxivAtom(
  xml: string,
  sourceId: string,
): { paper: NewExternalPaper; withdrawn: boolean } | null {
  // arXiv wraps results in <entry>; an empty result has zero <entry> blocks
  // (the feed-level <id> doesn't count). Bail fast.
  const entry = /<entry>([\s\S]*?)<\/entry>/i.exec(xml);
  if (!entry) return null;
  const body = entry[1] ?? '';

  const pickTag = (tag: string): string | null => {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const m = re.exec(body);
    return m ? decodeXml(m[1]!.trim()) : null;
  };

  const title = pickTag('title');
  if (!title) return null;
  const summary = pickTag('summary');
  const published = pickTag('published');
  const updated = pickTag('updated');

  // Authors — repeated <author><name>…</name>…</author>.
  const authors: ExternalAuthor[] = [];
  const authorRe = /<author>([\s\S]*?)<\/author>/gi;
  let am;
  while ((am = authorRe.exec(body)) !== null) {
    const block = am[1] ?? '';
    const nameMatch = /<name>([\s\S]*?)<\/name>/i.exec(block);
    if (!nameMatch) continue;
    const name = decodeXml(nameMatch[1]!.trim());
    // arXiv's affiliation tag may carry an inline namespace decl; allow
    // arbitrary attributes between the tag and `>`.
    const affMatch = /<arxiv:affiliation[^>]*>([\s\S]*?)<\/arxiv:affiliation>/i.exec(block);
    authors.push({ name, ...(affMatch ? { affiliation: decodeXml(affMatch[1]!.trim()) } : {}) });
  }

  // Primary category first, then any extra <category term=…>.
  const primaryMatch = /<arxiv:primary_category\s+[^>]*term="([^"]+)"/i.exec(body);
  const categories: string[] = [];
  if (primaryMatch) categories.push(primaryMatch[1]!);
  const catRe = /<category\s+[^>]*term="([^"]+)"/gi;
  let cm;
  while ((cm = catRe.exec(body)) !== null) {
    const t = cm[1]!;
    if (!categories.includes(t)) categories.push(t);
  }

  // DOI / journal-ref are optional; we capture the DOI when present.
  const doiMatch = /<arxiv:doi[^>]*>([\s\S]*?)<\/arxiv:doi>/i.exec(body);
  const doi = doiMatch ? decodeXml(doiMatch[1]!.trim()) : null;

  // arXiv signals a withdrawn paper with comment "This paper has been
  // withdrawn …" inside <arxiv:comment>; the more reliable test is that
  // the entry contains a <link rel="alternate" .../> but no <link
  // title="pdf" .../>. We treat either signal as withdrawn.
  const comment = (/<arxiv:comment[^>]*>([\s\S]*?)<\/arxiv:comment>/i.exec(body)?.[1] ?? '').toLowerCase();
  const hasPdfLink = /<link[^>]*title="pdf"/i.test(body);
  const withdrawn = comment.includes('withdrawn') || !hasPdfLink;

  // Pick the canonical entry URL — arXiv puts it in the <id> element which
  // is `http://arxiv.org/abs/{id}vN`.
  const entryIdMatch = /<id>([\s\S]*?)<\/id>/i.exec(body);
  const url = entryIdMatch ? decodeXml(entryIdMatch[1]!.trim()) : null;

  const publishedAt = parseDateSafe(published) ?? parseDateSafe(updated);

  return {
    paper: {
      source: 'arxiv',
      sourceId,
      title,
      authorsJson: authors,
      abstract: summary ?? null,
      categories,
      doi,
      url,
      license: null, // arXiv ATOM doesn't carry a structured license field
      publishedAt,
      withdrawn,
      fetchedAt: new Date(),
      rawMetadata: { atomBody: body.slice(0, 8_000) },
    },
    withdrawn,
  };
}

function parseDateSafe(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number.parseInt(d, 10)))
    .replace(/\s+/g, ' ')
    .trim();
}
