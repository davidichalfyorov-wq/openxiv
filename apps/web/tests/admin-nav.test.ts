import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('admin navigation', () => {
  it('exposes the admin stats dashboard to admins', () => {
    const source = readFileSync(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8');

    expect(source).toContain("me.user.role === 'admin'");
    expect(source).toContain('href="/admin/stats"');
    expect(source).toContain('Admin dashboard');
  });
});
