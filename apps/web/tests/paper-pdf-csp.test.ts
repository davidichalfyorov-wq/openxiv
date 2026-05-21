import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('paper PDF preview CSP', () => {
  it('allows same-origin PDF frames in production without allowing third-party framing', () => {
    const caddy = readFileSync(new URL('../../../Caddyfile.production', import.meta.url), 'utf8');

    expect(caddy).toContain("frame-src 'self'");
    expect(caddy).toContain("frame-ancestors 'self'");
    expect(caddy).toContain('X-Frame-Options "SAMEORIGIN"');
    expect(caddy).not.toContain("frame-src 'none'");
    expect(caddy).not.toContain('X-Frame-Options "DENY"');
  });
});
