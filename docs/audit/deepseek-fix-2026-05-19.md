# DeepSeek Suggest Fix Audit - 2026-05-19

## Root Cause

Production evidence came from `openxiv-api-1` on `173.212.216.82`.

- Backup was created before edits: `/root/suggest-fix-20260519-1434.tar.gz`.
- `docker logs openxiv-api-1 --tail 500 | grep -iE "deepseek|breaker|suggest"` returned no matches.
- The 24h log search found a failing `POST /api/summaries/suggest` at `2026-05-19T12:07:42Z`: `deepseek.generateText` logged `fetch failed`, then `[circuit:deepseek.generateText] open`.
- The next suggest request at `2026-05-19T12:08:04Z` returned `external_unavailable` / 502 because the breaker was open.
- Container dist drift check showed `max_tokens: 4096` and `resolveSuggestTextModel` were deployed, but the DeepSeek client still failed empty-content responses and still used `console.warn`.
- Opossum 8 defaults `volumeThreshold` to `0`; our wrapper did not set it, so one transient DeepSeek fetch failure could open the breaker.

Raw provider probe from inside the container is saved at `docs/audit/deepseek-raw-2026-05-19.json`.

Probe result:

- model: `deepseek-v4-flash`
- key prefix: `sk-1677a...`
- status: `200`
- finish reason: `stop`
- content: non-empty
- reasoning_content: present

Conclusion: the key and model were valid at probe time. The production 500/502 sequence was caused by a transient DeepSeek fetch failure plus an over-sensitive breaker. The client also had known DeepSeek response-shape gaps that could turn valid reasoning responses into `external_invalid_response`.

## Fix

- `packages/clients/src/circuit.ts`
  - Added explicit `DEFAULT_CIRCUIT_VOLUME_THRESHOLD = 5`.
  - Passed `volumeThreshold` into opossum so one transient failure does not open the breaker.

- `packages/clients/src/llm/deepseek.ts`
  - Returns trimmed `message.content` when present.
  - Falls back to trimmed `message.reasoning_content` when `content` is empty.
  - Returns `deepseek_truncated` AppError when both fields are empty and `finish_reason === "length"`.
  - Returns `deepseek_http_error` AppError with `{ status, body }`, with body truncated to 500 chars, for non-200 HTTP responses.
  - Removed `console.warn`; unexpected errors can be sent to a structured logger when one is provided.

- `apps/api/src/services/suggest.ts`
  - Locks the suggest route to `deepseek-v4-flash` whenever a DeepSeek API key is configured.
  - Keeps `maxTokens: 4096`.
  - Logs `{ sessionId, tier, model }` at info level for every suggest call through Fastify's structured logger.

- `apps/api/src/routes/uploads.ts` and `apps/api/src/routes/intake.ts`
  - Verified policy: at least one summary is required, one to three tiers are accepted, duplicate tiers are rejected.

- `apps/web/src/components/SubmissionWizard.tsx`
  - Summary step now states: "At least one plain-language summary tier is required. The other tiers are optional, recommended."
  - The wizard still allows submit with any one valid tier and blocks zero valid summaries.

## Verification

Local verification before deploy:

- `pnpm --filter @openxiv/clients test -- src/circuit.test.ts src/llm/deepseek.test.ts`: 11 passed.
- `pnpm -w typecheck`: passed.
- `pnpm -w build`: passed.
- `pnpm -w test`: passed, including `@openxiv/clients` 38 tests, `@openxiv/web` 71 tests, `@openxiv/api` 420 tests.

## Follow-up Findings

- The production model was restored to `DEEPSEEK_MODEL_TEXT=deepseek-v4-flash` after a temporary smoke-test change. The suggest service now reports `deepseek-v4-flash` even if `DEEPSEEK_MODEL_TEXT` is empty or stale.
- The publish-step 500 reported around `2026-05-19T12:59:23Z` was visible in Caddy access logs as four `POST /api-proxy/submissions/finalize` responses with `status=500`, `size=0`, and ~10-26 ms duration. The same 12048-byte request succeeded with `201` at `2026-05-19T12:59:49Z`. No API AppError existed in the current container logs for that window, and the pattern matches a deployment/restart upstream gap rather than finalize validation.
- Admin dashboard visibility root cause: the base header only exposed `/admin/moderation` as `Review`; `/admin/stats` existed but was not linked for admins.
- LaTeX rendering root causes: `/paper/[id]` did not load MathJax, and production CSP did not allow `https://cdn.jsdelivr.net` for the MathJax script already used by the reader page.

Deployment and final production e2e evidence will be appended after the VPS build and smoke tests.
