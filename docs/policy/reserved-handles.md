# Reserved handles

OpenXiv reserves ~100 handles from the user namespace. A reservation
forbids end-user registration of the handle but does not occupy a row
in `users` — the validation lives in `apps/api/src/services/reserved-handles.ts`.

## Categories

1. **Infrastructure paths.** Names that collide with an app route
   or a public asset. `admin`, `api`, `auth`, `login`, `submit`,
   `paper`, `papers`, `feed`, `search`, `topics`, `u`, `oauth`,
   `health`, `metrics`, `status`, `settings`, `profile`, `embed`,
   `humans`, `robots`, `sitemap`, etc. Allowing them as handles
   would shadow the route via `/@:handle`.

2. **Network/DNS labels.** `www`, `ftp`, `mail`, `smtp`, `ns1`,
   `ns2`, `dns`. Conventional and reserved by RFC, plus they show
   up in DNS lookups for subdomain claims.

3. **Tech generic.** Names that look authoritative in conversation
   and cause confusion: `null`, `undefined`, `nan`, `true`, `false`,
   `this`, `self`, `bot`, `test`, `demo`, `example`, etc.

4. **DID prefixes.** `did`, `did-web`, `did-plc`, `did-key`.

5. **Owner/project-specific.** `openxiv`, `official`, plus the
   personal handles of the founder (`ddavidich`, `davidich`,
   `davidalfyorov`).

## Normalisation

Matching is performed on the **NFKC + lower-case + whitespace/underscore
stripped** form. So `ＡＤＭＩＮ` (fullwidth), `Admin` (mixed case),
`a_d_m_i_n` (underscore-padded) all match `admin`.

## Anti-impersonation

The reserved set protects exact matches. `apps/api/src/services/impersonation.ts`
adds a fuzzy layer that catches:

- Levenshtein distance ≤ 1 from any high-value name (`openxiv`,
  `admin`, `mod`, `support`, owner names) → reject.
- Levenshtein distance = 2 from a 5+ char high-value name → reject.
- Confusables: digit-letter homoglyphs (`0`→o, `1`→l, …) and Cyrillic
  lookalikes are folded before comparison.

## Adding to the list

Append the new name to the appropriate category in
`apps/api/src/services/reserved-handles.ts` and update the
`docs/policy/reserved-handles.md` table in the same PR. Reserve count
is checked at startup so a regression catching the count silently
shrinking would surface.
