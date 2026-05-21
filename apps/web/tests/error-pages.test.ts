import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pages = [
  { file: '../src/pages/404.astro', title: 'Page not found' },
  { file: '../src/pages/500.astro', title: 'Something went wrong' },
] as const;

describe('branded error pages', () => {
  it.each(pages)('$file uses the site shell and does not expose framework internals', ({ file, title }) => {
    const url = new URL(file, import.meta.url);
    expect(existsSync(url)).toBe(true);
    const source = readFileSync(url, 'utf8');

    expect(source).toContain("import Base from '../layouts/Base.astro'");
    expect(source).toContain(title);
    expect(source).not.toContain('Path:');
    expect(source.toLowerCase()).not.toContain('stack trace');
    expect(source).toContain('href="/search"');
    expect(source).toContain('href="/"');
  });
});
