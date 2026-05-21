import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('stats surface', () => {
  it('keeps dense stats tables inside mobile-safe wrappers', () => {
    const source = readFileSync(new URL('../src/pages/stats.astro', import.meta.url), 'utf8');

    expect(source).toContain('class="stats-table-wrap"');
    expect(source).toContain('class="stats-table"');
    expect(source).toContain('overflow-x: auto');
    expect(source).toContain('max-width: 100%');
    expect(source).toContain('@media (max-width: 700px)');
  });
});
