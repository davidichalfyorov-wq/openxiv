# Handle character set

OpenXiv handles are **ASCII-only**, 3..30 characters, matching the
regex `/^[a-z0-9](?:[a-z0-9._-]{1,28}[a-z0-9])?$/`.

## Why ASCII?

The decision is deliberate, not capacity-driven. Three reasons:

1. **Impersonation surface.** Unicode supports tens of thousands of
   visually-confusable characters (`о` U+043E vs `o` U+006F is the
   classic example). A handle like `аdmin` (Cyrillic а) renders
   identically to `admin` in most fonts. We catch the most common
   substitutions in `impersonation.ts`, but the full confusables
   table is enormous and our defence is necessarily incomplete. ASCII
   eliminates the entire class.

2. **URL/path safety.** `/@{handle}` and `/u/{handle}` paths flow
   through every layer of the stack (Caddy, Astro SSR, browser
   history, social-share metadata). Each layer has its own opinion
   about how to encode/decode non-ASCII; the production-bug incident
   (triple percent-encoding of a DID) showed how a single
   double-encode propagates through five layers before failing. ASCII
   handles never trigger any of them.

3. **AT-proto compatibility.** atproto handles are constrained to
   ASCII per the spec (`com.atproto.identity.resolveHandle`). Allowing
   Unicode locally would mean a class of users whose openxiv handle
   couldn't appear in Bluesky records — a UX cliff we'd rather not
   manufacture.

## Allowed characters

| Position | Allowed |
|---|---|
| First | `[a-z0-9]` |
| Middle | `[a-z0-9._-]` |
| Last | `[a-z0-9]` |

## Trade-offs

We accept the trade-off:

- Non-Latin-script researchers must choose an ASCII handle even if
  it doesn't match their display name. They can still set
  `display_name` to their preferred form (the profile page surfaces
  the display name prominently; the handle appears as `@handle` in
  smaller text).

- The Unicode normalisation step still runs against the candidate —
  the case-folding catches fullwidth Latin and other ASCII-adjacent
  scripts. The validator rejects them with a clear message rather
  than silently accepting.

## Future relaxation

We may revisit if:

- AT-proto introduces an internationalised handle profile.
- A confusables-resistant library matures (full Unicode CLDR-based
  skeleton matching with fontset-derived adversarial cover).
- Operator capacity allows manual approval of non-ASCII handles via a
  moderator queue.

Until any of those land, ASCII is the policy.
