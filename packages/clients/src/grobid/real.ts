import { Errors, fromPromise } from '@openxiv/shared';
import { DEFAULT_HTTP_TIMEOUT_MS, fetchWithTimeoutRetry } from '../http.js';
import type { ExtractedMetadata, GrobidExtractor } from './interface.js';

export interface GrobidConfig {
  readonly url: string;
  readonly timeoutMs?: number;
}

/**
 * Minimal GROBID HTTP client. Posts the PDF to /api/processFulltextDocument
 * and asks GROBID to return TEI XML. We parse only the fields the API needs.
 */
export function makeGrobidExtractor(cfg: GrobidConfig): GrobidExtractor {
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  return {
    extract(pdf) {
      const work = async (): Promise<ExtractedMetadata> => {
        const form = new FormData();
        form.append('input', new Blob([pdf], { type: 'application/pdf' }), 'paper.pdf');
        form.append('consolidateHeader', '1');
        form.append('consolidateCitations', '0');

        const res = await fetchWithTimeoutRetry(`${cfg.url}/api/processFulltextDocument`, {
          method: 'POST',
          body: form,
          timeoutMs,
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          throw new Error(`grobid ${res.status}: ${detail.slice(0, 500)}`);
        }
        const tei = await res.text();

        return parseTei(tei);
      };
      return fromPromise(work(), (cause) =>
        Errors.externalInvalidResponse('grobid.extract', cause),
      );
    },
  };
}

/**
 * Very small TEI parser using regex. GROBID's TEI is well-formed and we only
 * need a handful of fields; pulling in a full XML parser would be overkill.
 */
function parseTei(tei: string): ExtractedMetadata {
  const titleMatch = /<title[^>]*type="main"[^>]*>([\s\S]*?)<\/title>/i.exec(tei);
  const abstractMatch = /<abstract[^>]*>([\s\S]*?)<\/abstract>/i.exec(tei);
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(tei);

  const authors: Array<{ displayName: string; orcid?: string; affiliation?: string }> = [];
  const authorRe = /<author[^>]*>([\s\S]*?)<\/author>/g;
  let am: RegExpExecArray | null;
  while ((am = authorRe.exec(tei)) !== null) {
    const block = am[1] ?? '';
    const forename = (/<forename[^>]*>([^<]+)<\/forename>/i.exec(block)?.[1] ?? '').trim();
    const surname = (/<surname[^>]*>([^<]+)<\/surname>/i.exec(block)?.[1] ?? '').trim();
    const displayName = [forename, surname].filter(Boolean).join(' ').trim();
    if (!displayName) continue;
    const orcid = /<idno[^>]*type="ORCID"[^>]*>([^<]+)<\/idno>/i.exec(block)?.[1]?.trim();
    const affiliation = /<orgName[^>]*>([^<]+)<\/orgName>/i.exec(block)?.[1]?.trim();
    authors.push({
      displayName,
      ...(orcid ? { orcid } : {}),
      ...(affiliation ? { affiliation } : {}),
    });
  }

  const references: string[] = [];
  const refRe = /<biblStruct[^>]*>([\s\S]*?)<\/biblStruct>/g;
  let rm: RegExpExecArray | null;
  while ((rm = refRe.exec(tei)) !== null) {
    const cleaned = (rm[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned) references.push(cleaned.slice(0, 1000));
  }

  const title = stripTags(titleMatch?.[1])?.trim();
  const abstract = stripTags(abstractMatch?.[1])?.trim();
  return {
    ...(title ? { title } : {}),
    ...(abstract ? { abstract } : {}),
    authors,
    references,
    bodyText: stripTags(bodyMatch?.[1]) ?? '',
  };
}

function stripTags(html?: string): string | undefined {
  if (!html) return undefined;
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
