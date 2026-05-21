import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const roots = [
  join(process.cwd(), '..', 'api', 'src'),
  join(process.cwd(), 'src'),
];
const sourceExt = /\.(astro|tsx?|mts|cts)$/;
const explicitAny = /(:\s*any\b|\bas\s+any\b|<any>)/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walk(full));
    } else if (
      sourceExt.test(entry) &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.test.tsx')
    ) {
      out.push(full);
    }
  }
  return out;
}

describe('production source explicit any', () => {
  it('keeps apps/api/src and apps/web/src free of explicit any casts/types', () => {
    const offenders = roots
      .flatMap(walk)
      .flatMap((file) => {
        const rel = file.replace(process.cwd(), '').replace(/^[\\/]/, '');
        return readFileSync(file, 'utf8')
          .split(/\r?\n/)
          .map((line, idx) => ({ rel, line, lineNo: idx + 1 }))
          .filter((item) => !/^\s*(\/\*|\*|\/\/)/.test(item.line))
          .filter((item) => explicitAny.test(item.line))
          .map((item) => `${item.rel}:${item.lineNo}: ${item.line.trim()}`);
      });

    expect(offenders).toEqual([]);
  });
});
