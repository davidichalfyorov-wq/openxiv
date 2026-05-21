import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { CATEGORIES, OPENXIV_ISSN, issnUrn, openxivIdToUrl } from '@openxiv/shared';
import type { PaperWithRelations } from '@openxiv/db';
import type Redis from 'ioredis';

/**
 * OAI-PMH v2.0 endpoint at /oai-pmh.
 * Returns Dublin Core XML (`oai_dc` metadata prefix) so Google Scholar /
 * BASE / CORE / OpenAIRE crawlers can ingest us. Sets correspond to subject
 * categories. Pagination via opaque base64-encoded resumption tokens.
 *
 * Spec reference: https://www.openarchives.org/OAI/openarchivesprotocol.html
 */
const PAGE_SIZE = 100;
const REPO_NAME = 'OpenXiv';
const ADMIN_EMAIL = 'davidich.alfyorov@gmail.com';
// Canonical OAI XSD URL on HTTPS. BASE OVAL validator (oval.base-search.net)
// rejects self-hosted XSDs and dublincore.org URLs outright. The only URL
// that passes is the same one arXiv uses: https with www, served by the
// official openarchives.org domain. The matching dc namespace XSD is imported
// from inside oai_dc.xsd; BASE bundles its own DC schema and resolves dc:title
// only when this exact URL is declared as the lone schemaLocation pair.
const OPENXIV_OAI_DC_SCHEMA = 'https://www.openarchives.org/OAI/2.0/oai_dc.xsd';
const NS = {
  oai: 'http://www.openarchives.org/OAI/2.0/',
  oaiDc: 'http://www.openarchives.org/OAI/2.0/oai_dc/',
  dc: 'http://purl.org/dc/elements/1.1/',
  xsi: 'http://www.w3.org/2001/XMLSchema-instance',
  // DataCite Schema 4 — used by Zenodo, Crossref, OpenAIRE for richer
  // bibliographic metadata than oai_dc can express (titles + types +
  // identifiers with explicit types).
  datacite: 'http://datacite.org/schema/kernel-4',
  // arXiv's own eprint format. Adopters like Inspire and NASA ADS prefer it
  // for physics/CS preprints — sub fields, comment lines, primary categories.
  arxivRaw: 'http://arxiv.org/OAI/arXiv/',
};

const SUPPORTED_PREFIXES = ['oai_dc', 'oai_datacite', 'arxiv'] as const;
type MetadataPrefix = (typeof SUPPORTED_PREFIXES)[number];
function isSupportedPrefix(s: string | null): s is MetadataPrefix {
  return s !== null && (SUPPORTED_PREFIXES as readonly string[]).includes(s);
}

const RESUMPTION_TTL_SECONDS = 3600;
function resumptionRedisKey(token: string): string {
  return `oai:resumption:${token}`;
}

type Verb =
  | 'Identify'
  | 'ListMetadataFormats'
  | 'ListSets'
  | 'ListRecords'
  | 'ListIdentifiers'
  | 'GetRecord';

interface ResumptionState {
  set?: string;
  offset: number;
  total: number;
  from?: string;
  until?: string;
  /** Persisted on the token so a paginating client cannot accidentally cross prefixes mid-walk. */
  prefix?: MetadataPrefix;
}

export async function oaiPmhRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  /** OAI baseURL — protocol/SEO field, points at this endpoint. */
  const baseUrl = ctx.env.PUBLIC_WEB_BASE;
  /** Web base for human-readable /p/{id} URLs surfaced in records. */
  const webBase = ctx.env.PUBLIC_WEB_BASE;
  const earliestStatic = '2026-01-01T00:00:00Z';

  app.get('/oai-pmh', async (req, reply) => respond(req, reply));
  app.post('/oai-pmh', async (req, reply) => respond(req, reply));

  async function respond(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const params = collectParams(req);
    const verb = (params.get('verb') ?? '') as Verb;
    const requestEcho = renderRequestEcho(verb, params, baseUrl);

    reply
      .header('content-type', 'application/xml; charset=utf-8')
      .header('cache-control', 'public, max-age=120');

    if (!verb) {
      return reply.send(envelope(requestEcho, error('badVerb', 'verb argument is required')));
    }

    switch (verb) {
      case 'Identify': {
        const body = `
          <Identify>
            <repositoryName>${esc(REPO_NAME)}</repositoryName>
            <baseURL>${esc(baseUrl)}/oai-pmh</baseURL>
            <protocolVersion>2.0</protocolVersion>
            <adminEmail>${esc(ADMIN_EMAIL)}</adminEmail>
            <earliestDatestamp>${earliestStatic}</earliestDatestamp>
            <deletedRecord>transient</deletedRecord>
            <granularity>YYYY-MM-DDThh:mm:ssZ</granularity>
            <description>
              <oai-identifier xmlns="http://www.openarchives.org/OAI/2.0/oai-identifier"
                              xmlns:xsi="${NS.xsi}"
                              xsi:schemaLocation="http://www.openarchives.org/OAI/2.0/oai-identifier
                                                 http://www.openarchives.org/OAI/2.0/oai-identifier.xsd">
                <scheme>oai</scheme>
                <repositoryIdentifier>openxiv.net</repositoryIdentifier>
                <delimiter>:</delimiter>
                <sampleIdentifier>oai:openxiv.net:openxiv:cs.AI.2026.00001</sampleIdentifier>
              </oai-identifier>
            </description>
          </Identify>`;
        return reply.send(envelope(requestEcho, body));
      }

      case 'ListMetadataFormats': {
        const body = `
          <ListMetadataFormats>
            <metadataFormat>
              <metadataPrefix>oai_dc</metadataPrefix>
              <schema>${OPENXIV_OAI_DC_SCHEMA}</schema>
              <metadataNamespace>${NS.oaiDc}</metadataNamespace>
            </metadataFormat>
            <metadataFormat>
              <metadataPrefix>oai_datacite</metadataPrefix>
              <schema>http://schema.datacite.org/oai/oai-1.1/oai.xsd</schema>
              <metadataNamespace>${NS.datacite}</metadataNamespace>
            </metadataFormat>
            <metadataFormat>
              <metadataPrefix>arxiv</metadataPrefix>
              <schema>http://arxiv.org/OAI/arXiv.xsd</schema>
              <metadataNamespace>${NS.arxivRaw}</metadataNamespace>
            </metadataFormat>
          </ListMetadataFormats>`;
        return reply.send(envelope(requestEcho, body));
      }

      case 'ListSets': {
        const setItems = CATEGORIES.map(
          (c) =>
            `<set><setSpec>${esc(c.code)}</setSpec><setName>${esc(c.group)}: ${esc(c.name)}</setName>${
              c.description ? `<setDescription>${esc(c.description)}</setDescription>` : ''
            }</set>`,
        ).join('\n');
        return reply.send(envelope(requestEcho, `<ListSets>${setItems}</ListSets>`));
      }

      case 'GetRecord': {
        const identifier = params.get('identifier');
        const prefix = params.get('metadataPrefix');
        if (!identifier) {
          return reply.send(envelope(requestEcho, error('badArgument', 'identifier required')));
        }
        if (!isSupportedPrefix(prefix)) {
          return reply.send(
            envelope(
              requestEcho,
              error('cannotDisseminateFormat', `unsupported metadataPrefix: ${prefix ?? '(missing)'}`),
            ),
          );
        }
        const openxivId = identifierToOpenxiv(identifier);
        if (!openxivId) {
          return reply.send(envelope(requestEcho, error('idDoesNotExist', `bad oai id ${identifier}`)));
        }
        const paperRes = await ctx.repos.papers.findByOpenxivId(openxivId);
        if (paperRes.isErr() || !paperRes.value) {
          return reply.send(envelope(requestEcho, error('idDoesNotExist', identifier)));
        }
        const loaded = await ctx.repos.papers.loadWithRelations(paperRes.value.id);
        if (loaded.isErr() || !loaded.value) {
          return reply.send(envelope(requestEcho, error('idDoesNotExist', identifier)));
        }
        const xml = recordXml(loaded.value, baseUrl, webBase, prefix);
        return reply.send(envelope(requestEcho, `<GetRecord>${xml}</GetRecord>`));
      }

      case 'ListIdentifiers':
      case 'ListRecords': {
        const prefixParam = params.get('metadataPrefix');
        const resumptionToken = params.get('resumptionToken');
        if (!resumptionToken && !isSupportedPrefix(prefixParam)) {
          return reply.send(
            envelope(
              requestEcho,
              error('cannotDisseminateFormat', `unsupported metadataPrefix: ${prefixParam ?? '(missing)'}`),
            ),
          );
        }
        const fromRaw = params.get('from');
        const untilRaw = params.get('until');
        if ((fromRaw && !isOaiDate(fromRaw)) || (untilRaw && !isOaiDate(untilRaw))) {
          return reply.send(
            envelope(requestEcho, error('badArgument', 'from/until must be YYYY-MM-DD or YYYY-MM-DDThh:mm:ssZ')),
          );
        }
        const state = resumptionToken
          ? await loadResumption(ctx.redis, resumptionToken)
          : ({
              set: params.get('set') ?? undefined,
              offset: 0,
              total: -1,
              from: fromRaw ?? undefined,
              until: untilRaw ?? undefined,
              prefix: prefixParam as MetadataPrefix,
            } satisfies ResumptionState);
        if (!state) {
          return reply.send(
            envelope(requestEcho, error('badResumptionToken', 'malformed or expired resumption token')),
          );
        }
        const prefix: MetadataPrefix = state.prefix ?? 'oai_dc';
        const updatedFrom = state.from ? parseOaiDate(state.from, 'from') : undefined;
        const updatedUntil = state.until ? parseOaiDate(state.until, 'until') : undefined;
        const listResult = await ctx.repos.papers.list({
          status: 'published',
          ...(state.set ? { primaryCategory: state.set } : {}),
          ...(updatedFrom ? { updatedFrom } : {}),
          ...(updatedUntil ? { updatedUntil } : {}),
          limit: PAGE_SIZE,
          offset: state.offset,
        });
        if (listResult.isErr()) {
          return reply.send(envelope(requestEcho, error('badArgument', listResult.error.message)));
        }
        const rows = listResult.value;
        const remaining = rows.length === PAGE_SIZE;
        const nextOffset = state.offset + rows.length;
        const nextToken = remaining
          ? await storeResumption(ctx.redis, { ...state, offset: nextOffset, total: state.total, prefix })
          : '';

        const records: string[] = [];
        for (const row of rows) {
          const loaded = await ctx.repos.papers.loadWithRelations(row.id);
          if (loaded.isErr() || !loaded.value) continue;
          if (verb === 'ListRecords') {
            records.push(recordXml(loaded.value, baseUrl, webBase, prefix));
          } else {
            records.push(headerXml(loaded.value, baseUrl));
          }
        }

        if (records.length === 0 && state.offset === 0) {
          return reply.send(envelope(requestEcho, error('noRecordsMatch', 'no matching records')));
        }

        const inner = records.join('\n');
        const resumption = nextToken
          ? `<resumptionToken cursor="${state.offset}">${nextToken}</resumptionToken>`
          : state.offset > 0
            ? `<resumptionToken cursor="${state.offset}"/>`
            : '';
        const tag = verb === 'ListRecords' ? 'ListRecords' : 'ListIdentifiers';
        return reply.send(envelope(requestEcho, `<${tag}>${inner}${resumption}</${tag}>`));
      }

      default:
        return reply.send(envelope(requestEcho, error('badVerb', `unsupported verb: ${verb}`)));
    }
  }
}

// ---------- helpers ----------

function collectParams(req: FastifyRequest): URLSearchParams {
  const url = new URL(req.url, 'http://placeholder');
  const out = new URLSearchParams(url.search);
  // POST with form-encoded body
  if (req.method === 'POST' && typeof req.body === 'object' && req.body) {
    for (const [k, v] of Object.entries(req.body as Record<string, unknown>)) {
      if (typeof v === 'string') out.set(k, v);
    }
  }
  return out;
}

function envelope(requestEcho: string, payload: string): string {
  const now = new Date().toISOString().replace(/\.\d{3}/, '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH xmlns="${NS.oai}"
         xmlns:xsi="${NS.xsi}"
         xsi:schemaLocation="${NS.oai} http://www.openarchives.org/OAI/2.0/OAI-PMH.xsd">
  <responseDate>${now}</responseDate>
  ${requestEcho}
  ${payload}
</OAI-PMH>`;
}

function renderRequestEcho(verb: string, params: URLSearchParams, baseUrl: string): string {
  const attrs = ['verb'];
  for (const k of ['identifier', 'metadataPrefix', 'set', 'from', 'until', 'resumptionToken']) {
    if (params.get(k)) attrs.push(k);
  }
  const pieces = attrs
    .map((k) => `${k}="${esc(k === 'verb' ? verb : params.get(k) ?? '')}"`)
    .join(' ');
  return `<request ${pieces}>${esc(baseUrl)}/oai-pmh</request>`;
}

function error(code: string, message: string): string {
  return `<error code="${esc(code)}">${esc(message)}</error>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function oaiIdentifier(openxivId: string): string {
  return `oai:openxiv.net:${openxivId.replace(/^openxiv:/, 'openxiv:')}`;
}

function identifierToOpenxiv(identifier: string): string | null {
  const m = /^oai:openxiv\.net:(openxiv:.+)$/.exec(identifier);
  return m ? m[1] ?? null : null;
}

/**
 * Format an ISO timestamp at second granularity (YYYY-MM-DDThh:mm:ssZ).
 * OAI-PMH 2.0 §3.3.1 only allows this exact form once the repository
 * declares it in Identify; BASE / CORE / OpenAIRE harvesters reject
 * millisecond-precision timestamps with "Incorrect format for datestamp".
 */
function oaiDate(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function headerXml(
  loaded: PaperWithRelations,
  _baseUrl: string,
): string {
  // datestamp MUST be the column we filter on for incremental harvest —
  // otherwise BASE's "harvest from <last datestamp> returns 0 records"
  // check fails. `papers.list` filters on `updated_at`, so we anchor the
  // datestamp on `updatedAt`. publishedAt may be NULL for legacy rows
  // anyway; updatedAt is monotone and always populated.
  const datestamp = oaiDate(loaded.paper.updatedAt);
  const setSpec = loaded.paper.primaryCategory;
  return `<header>
    <identifier>${esc(oaiIdentifier(loaded.paper.openxivId ?? loaded.paper.id))}</identifier>
    <datestamp>${datestamp}</datestamp>
    <setSpec>${esc(setSpec)}</setSpec>
  </header>`;
}

function recordXml(
  loaded: PaperWithRelations,
  apiBase: string,
  webBase: string,
  prefix: MetadataPrefix,
): string {
  const inner =
    prefix === 'oai_datacite'
      ? renderDataCite(loaded, webBase)
      : prefix === 'arxiv'
        ? renderArxivRaw(loaded, webBase)
        : renderOaiDc(loaded, webBase);
  return `<record>
    ${headerXml(loaded, apiBase)}
    <metadata>${inner}</metadata>
  </record>`;
}

function absLocalUrl(loaded: PaperWithRelations, webBase: string): string {
  return loaded.paper.openxivId
    ? `${webBase}/p/${openxivIdToUrl(loaded.paper.openxivId)}`
    : `${webBase}/paper/${loaded.paper.id}`;
}

function renderOaiDc(loaded: PaperWithRelations, webBase: string): string {
  const absLocal = absLocalUrl(loaded, webBase);
  const dcAuthors = loaded.authors
    .map((a) => `<dc:creator>${esc(a.displayName)}</dc:creator>`)
    .join('');
  const dcSubjects = [loaded.paper.primaryCategory, ...loaded.categories.filter((c) => c !== loaded.paper.primaryCategory)]
    .map((c) => `<dc:subject>${esc(c)}</dc:subject>`)
    .join('');
  const dcKeywords = loaded.keywords.map((k) => `<dc:subject>${esc(k)}</dc:subject>`).join('');
  const date = oaiDate(loaded.paper.publishedAt ?? loaded.paper.createdAt);
  // ISO 639-3 three-letter code. We currently accept English-only manuscripts;
  // when a multilingual track lands, source this from PaperRecord.language.
  // BASE flags repositories without dc:language as "UNVERIFIED" on harvest.
  const language = 'eng';
  // Canonical schemaLocation pair. BASE OVAL rejects anything else as
  // "invalid schemaLocation" and rejects missing schemaLocation with a strict
  // wildcard error. Same value arXiv uses; verified live against oval.base-search.net.
  return `<oai_dc:dc xmlns:oai_dc="${NS.oaiDc}"
                 xmlns:dc="${NS.dc}"
                 xmlns:xsi="${NS.xsi}"
                 xsi:schemaLocation="${NS.oaiDc} ${OPENXIV_OAI_DC_SCHEMA}">
        <dc:title>${esc(loaded.paper.title)}</dc:title>
        ${dcAuthors}
        ${dcSubjects}
        ${dcKeywords}
        ${loaded.paper.abstract ? `<dc:description>${esc(loaded.paper.abstract)}</dc:description>` : ''}
        <dc:date>${esc(date)}</dc:date>
        <dc:type>info:eu-repo/semantics/preprint</dc:type>
        <dc:type>text</dc:type>
        <dc:format>application/pdf</dc:format>
        <dc:identifier>${esc(loaded.paper.openxivId ?? loaded.paper.id)}</dc:identifier>
        <dc:identifier>${esc(absLocal)}</dc:identifier>
        <dc:identifier>${esc(issnUrn())}</dc:identifier>
        ${loaded.paper.doi ? `<dc:identifier>doi:${esc(loaded.paper.doi)}</dc:identifier>` : ''}
        <dc:source>${esc(issnUrn())}</dc:source>
        <dc:language>${language}</dc:language>
        <dc:publisher>OpenXiv</dc:publisher>
        <dc:rights>info:eu-repo/semantics/openAccess</dc:rights>
        ${licenseHref(loaded.paper.license) ? `<dc:rights>${esc(licenseHref(loaded.paper.license))}</dc:rights>` : ''}
        <dc:rights>${esc(loaded.paper.license)}</dc:rights>
      </oai_dc:dc>`;
}

/**
 * DataCite Schema 4 record. Used by OpenAIRE / Zenodo / Crossref-event-data.
 * We map our fields conservatively — `Preprint` resourceTypeGeneral, OpenXiv
 * id as the primary identifier with type=URL pointing at the abs page.
 */
function renderDataCite(loaded: PaperWithRelations, webBase: string): string {
  const absLocal = absLocalUrl(loaded, webBase);
  const creators = loaded.authors
    .map(
      (a) => `<creator>
          <creatorName>${esc(a.displayName)}</creatorName>
          ${a.orcid ? `<nameIdentifier nameIdentifierScheme="ORCID" schemeURI="https://orcid.org">${esc(a.orcid)}</nameIdentifier>` : ''}
          ${a.affiliation ? `<affiliation>${esc(a.affiliation)}</affiliation>` : ''}
        </creator>`,
    )
    .join('');
  const subjects = [loaded.paper.primaryCategory, ...loaded.categories.filter((c) => c !== loaded.paper.primaryCategory)]
    .map((c) => `<subject subjectScheme="OpenXiv">${esc(c)}</subject>`)
    .join('');
  const keywords = loaded.keywords.map((k) => `<subject>${esc(k)}</subject>`).join('');
  const year = (loaded.paper.publishedAt ?? loaded.paper.createdAt).toISOString().slice(0, 4);
  const date = oaiDate(loaded.paper.publishedAt ?? loaded.paper.createdAt);
  return `<resource xmlns="${NS.datacite}"
                 xmlns:xsi="${NS.xsi}"
                 xsi:schemaLocation="${NS.datacite} http://schema.datacite.org/meta/kernel-4/metadata.xsd">
        <identifier identifierType="${loaded.paper.doi ? 'DOI' : 'URL'}">${esc(loaded.paper.doi ?? absLocal)}</identifier>
        <creators>${creators}</creators>
        <titles><title>${esc(loaded.paper.title)}</title></titles>
        <publisher>OpenXiv</publisher>
        <publicationYear>${esc(year)}</publicationYear>
        <resourceType resourceTypeGeneral="Preprint">Preprint</resourceType>
        ${subjects || keywords ? `<subjects>${subjects}${keywords}</subjects>` : ''}
        ${loaded.paper.abstract ? `<descriptions><description descriptionType="Abstract">${esc(loaded.paper.abstract)}</description></descriptions>` : ''}
        <dates><date dateType="Issued">${esc(date)}</date></dates>
        <rightsList><rights rightsURI="${esc(licenseHref(loaded.paper.license))}">${esc(loaded.paper.license)}</rights></rightsList>
        <alternateIdentifiers>
          <alternateIdentifier alternateIdentifierType="OpenXiv">${esc(loaded.paper.openxivId ?? loaded.paper.id)}</alternateIdentifier>
          <alternateIdentifier alternateIdentifierType="ISSN">${esc(OPENXIV_ISSN)}</alternateIdentifier>
        </alternateIdentifiers>
      </resource>`;
}

function licenseHref(license: string): string {
  const map: Record<string, string> = {
    'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
    'CC-BY-SA-4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
    'CC-BY-NC-4.0': 'https://creativecommons.org/licenses/by-nc/4.0/',
    'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
  };
  return map[license] ?? '';
}

/**
 * arXiv eprint format. We adopt the same XML the arXiv repository emits so
 * downstream tools (Inspire HEP, NASA ADS, Semantic Scholar) can parse
 * OpenXiv records with their existing arXiv pipelines.
 */
function renderArxivRaw(loaded: PaperWithRelations, _webBase: string): string {
  const openxivShort = loaded.paper.openxivId?.replace(/^openxiv:/, '') ?? loaded.paper.id;
  const authorBlocks = loaded.authors
    .map((a) => {
      // arXiv author splits on last space — we don't have first/last names,
      // so the displayName goes in `keyname` and the orcid (if any) in `id`.
      return `<author>
          <keyname>${esc(a.displayName)}</keyname>
          ${a.affiliation ? `<affiliation>${esc(a.affiliation)}</affiliation>` : ''}
        </author>`;
    })
    .join('');
  const created = loaded.paper.createdAt.toISOString().slice(0, 10);
  const updated = loaded.paper.updatedAt.toISOString().slice(0, 10);
  return `<arXiv xmlns="${NS.arxivRaw}"
                 xmlns:xsi="${NS.xsi}"
                 xsi:schemaLocation="${NS.arxivRaw} http://arxiv.org/OAI/arXiv.xsd">
        <id>${esc(openxivShort)}</id>
        <created>${esc(created)}</created>
        <updated>${esc(updated)}</updated>
        <authors>${authorBlocks}</authors>
        <title>${esc(loaded.paper.title)}</title>
        <categories>${esc([loaded.paper.primaryCategory, ...loaded.categories.filter((c) => c !== loaded.paper.primaryCategory)].join(' '))}</categories>
        ${loaded.paper.abstract ? `<abstract>${esc(loaded.paper.abstract)}</abstract>` : ''}
        ${loaded.paper.doi ? `<doi>${esc(loaded.paper.doi)}</doi>` : ''}
        <license>${esc(loaded.paper.license)}</license>
      </arXiv>`;
}

/**
 * Persist resumption state in Redis with TTL, returning an opaque random
 * token. Falls back to base64-encoded inline state if Redis is unavailable,
 * so the protocol keeps working even with the cache down.
 *
 * The TTL means tokens expire after an hour of idle pagination, matching the
 * arXiv resumption-token policy. A harvester that pauses overnight will get
 * a freshly minted badResumptionToken response — that's the safer mode
 * because their offset assumption may be stale anyway.
 */
async function storeResumption(redis: Redis, state: ResumptionState): Promise<string> {
  try {
    const token = randomToken();
    await redis.set(resumptionRedisKey(token), JSON.stringify(state), 'EX', RESUMPTION_TTL_SECONDS);
    return `r:${token}`;
  } catch {
    return encodeResumption(state);
  }
}

function encodeResumption(state: ResumptionState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
}

function randomToken(): string {
  // 16 bytes of randomness → 32 base64url chars. Plenty of entropy to make
  // collisions astronomically unlikely without bloating the URL.
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');
}

async function loadResumption(
  redis: Redis,
  token: string,
): Promise<ResumptionState | null> {
  if (token.startsWith('r:')) {
    try {
      const raw = await redis.get(resumptionRedisKey(token.slice(2)));
      if (!raw) return null;
      return JSON.parse(raw) as ResumptionState;
    } catch {
      return null;
    }
  }
  // Legacy base64 path — keeps long-running harvest jobs that grabbed a
  // pre-Redis token working through the transition.
  return decodeResumption(token);
}

/**
 * OAI-PMH datestamps accept "YYYY-MM-DD" (day granularity) or
 * "YYYY-MM-DDThh:mm:ssZ" (seconds, UTC only). Anything else MUST be
 * rejected with badArgument per spec §3.1.1.
 */
const OAI_DATE_DAY = /^\d{4}-\d{2}-\d{2}$/;
const OAI_DATE_SEC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
export function isOaiDate(s: string): boolean {
  if (!OAI_DATE_DAY.test(s) && !OAI_DATE_SEC.test(s)) return false;
  // Catch "2026-13-40" — regex shape OK but month/day out of range.
  const d = new Date(OAI_DATE_DAY.test(s) ? s + 'T00:00:00Z' : s);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s.slice(0, 10);
}
export function parseOaiDate(s: string, kind: 'from' | 'until'): Date {
  if (OAI_DATE_SEC.test(s)) {
    const d = new Date(s);
    // Both bounds are inclusive per OAI-PMH §2.7.2. At seconds granularity
    // our DB still stores millisecond precision, so `until=14:57:54Z` must
    // match a record updated at `14:57:54.466Z`. Without rounding the
    // upper bound up to `.999`, BASE Validator's full-granularity
    // incremental check fails: it harvests by last-seen datestamp,
    // re-queries with `from=X&until=X`, and expects the same record back
    // — but `updatedAt <= 14:57:54.000` excludes `14:57:54.466`.
    if (kind === 'until') d.setUTCMilliseconds(999);
    return d;
  }
  // Day-granularity: `from` -> start of day, `until` -> end of day. This
  // makes a request like `from=2026-05-17&until=2026-05-17` actually include
  // anything updated on that day, not a zero-second window.
  const d = new Date(s + 'T00:00:00Z');
  if (kind === 'until') d.setUTCHours(23, 59, 59, 999);
  return d;
}

function decodeResumption(token: string): ResumptionState | null {
  try {
    const obj = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (typeof obj.offset !== 'number' || typeof obj.total !== 'number') return null;
    return obj as ResumptionState;
  } catch {
    return null;
  }
}
