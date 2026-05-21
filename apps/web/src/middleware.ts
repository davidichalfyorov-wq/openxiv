import { defineMiddleware } from 'astro:middleware';
import { salvageProfilePath } from './lib/url-salvage.js';

/**
 * Profile-URL salvage middleware. Catches paths under `/u/` and `/@`
 * where the slug segment is multiply-percent-encoded (`did%253A…`),
 * decodes until stable, and 301-redirects to the clean URL so the
 * downstream route handler sees a normal slug.
 *
 * The pure logic lives in `./lib/url-salvage.ts` so unit tests can call
 * it directly without booting Astro. We never throw out of middleware
 * because a thrown middleware kills page rendering globally; any
 * unexpected input falls through to `next()`.
 */
export const onRequest = defineMiddleware(async (ctx, next) => {
  const url = new URL(ctx.request.url);
  const cleanPath = salvageProfilePath(url.pathname);
  if (cleanPath) {
    return ctx.redirect(cleanPath, 301);
  }
  return next();
});
