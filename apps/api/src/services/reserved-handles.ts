/**
 * Reserved-handle registry.
 *
 * A handle in this set CANNOT be registered by an ordinary user, even
 * if the unique-index would allow it. Three categories:
 *
 *   1. **Infrastructure** — paths that overlap an app route or static
 *      asset (admin, api, login, …). Allowing them as handles would
 *      shadow real routes via the `/@:handle` redirect.
 *
 *   2. **Tech generic** — names like `null`, `bot`, `test`, `demo` that
 *      look authoritative to a casual reader and lead to confusion.
 *
 *   3. **Owner / project-specific** — pre-reserved for the operator
 *      (ddavidich, davidich, davidalfyorov) plus `openxiv` / `official`
 *      so a stranger can't impersonate the project itself.
 *
 * Matching is Unicode-NFKC normalised + case-folded. A handle like
 * `Admin` and `АDMIN` (Cyrillic A) both match `admin` here.
 *
 * Policy doc: docs/policy/reserved-handles.md (kept in sync with this list).
 */

const NORMALIZE = (s: string): string =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_]+/g, '');

const INFRASTRUCTURE = [
  'admin',
  'root',
  'help',
  'support',
  'about',
  'api',
  'auth',
  'login',
  'signin',
  'signup',
  'logout',
  'submit',
  'paper',
  'papers',
  'feed',
  'search',
  'topics',
  'u',
  'mod',
  'moderator',
  'staff',
  'system',
  'openxiv',
  'official',
  'www',
  'ftp',
  'mail',
  'smtp',
  'ns1',
  'ns2',
  'dns',
  'health',
  'healthz',
  'metrics',
  'status',
  'settings',
  'profile',
  'profiles',
  'oauth',
  'auth-callback',
  'preregistration',
  'preregistrations',
  'prereg',
  'discussion',
  'discussions',
  'lens',
  'featured',
  'briefs',
  'brief',
  'dailybrief',
  'humans',
  'robots',
  'sitemap',
  'manifest',
  'icon',
  'favicon',
  'apple-touch-icon',
  'embed',
  'embeds',
  'starter-pack',
  'starterpack',
  'labeler',
  'fg',
];

const TECH_GENERIC = [
  'anonymous',
  'anon',
  'null',
  'undefined',
  'nan',
  'true',
  'false',
  'this',
  'self',
  'you',
  'me',
  'bot',
  'test',
  'tester',
  'testing',
  'demo',
  'example',
  'foo',
  'bar',
  'baz',
  'qux',
  'admin1',
  'admin2',
];

const DID_PREFIXES = ['did', 'did-web', 'did-plc', 'did-key', 'didweb', 'didplc', 'didkey'];

const OWNER = ['ddavidich', 'davidich', 'davidalfyorov'];

const RESERVED_HANDLES_RAW = [
  ...INFRASTRUCTURE,
  ...TECH_GENERIC,
  ...DID_PREFIXES,
  ...OWNER,
];

const RESERVED_HANDLES: Set<string> = new Set(RESERVED_HANDLES_RAW.map(NORMALIZE));

/** Number of distinct entries reserved. Used by tests. */
export const RESERVED_COUNT = RESERVED_HANDLES.size;

export function isReservedHandle(candidate: string): boolean {
  return RESERVED_HANDLES.has(NORMALIZE(candidate));
}

/**
 * Validate the syntactic shape of a candidate handle. Returns the
 * normalised lowercase form on success, or a discriminated error.
 *
 * Rules:
 *   - 3..30 characters
 *   - starts and ends with [a-z0-9]
 *   - middle characters: [a-z0-9._-]
 *   - ASCII only (Unicode confusables go through the impersonation gate)
 *   - not all-numeric (avoids ambiguity with ORCID id suffixes)
 *   - not a DID-shaped string ("did:" prefix is rejected)
 */
export type HandleValidationResult =
  | { ok: true; handle: string }
  | { ok: false; reason: 'too_short' | 'too_long' | 'invalid_chars' | 'all_numeric' | 'did_shape' | 'reserved' };

const HANDLE_RE = /^[a-z0-9](?:[a-z0-9._-]{1,28}[a-z0-9])?$/;
const ALL_NUMERIC_RE = /^[0-9]+$/;

export function validateHandleShape(input: string): HandleValidationResult {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length < 3) return { ok: false, reason: 'too_short' };
  if (trimmed.length > 30) return { ok: false, reason: 'too_long' };
  if (trimmed.startsWith('did:') || trimmed.startsWith('did%3a')) {
    return { ok: false, reason: 'did_shape' };
  }
  if (!HANDLE_RE.test(trimmed)) return { ok: false, reason: 'invalid_chars' };
  if (ALL_NUMERIC_RE.test(trimmed)) return { ok: false, reason: 'all_numeric' };
  if (isReservedHandle(trimmed)) return { ok: false, reason: 'reserved' };
  return { ok: true, handle: trimmed };
}

export const __testing = { NORMALIZE, RESERVED_HANDLES_RAW };
