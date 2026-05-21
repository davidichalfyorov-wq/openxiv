import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatPaperStatus } from '../src/lib/paper-status';

describe('paper status labels', () => {
  it('keeps technical status values out of reader-facing copy', () => {
    expect(formatPaperStatus('pending_review')).toBe('Under review');
    expect(formatPaperStatus('compile_failed')).toBe('Needs source fixes');
    expect(formatPaperStatus('pending_disclosure')).toBe('Disclosure needed');
  });

  it('uses the shared formatter on paper-facing surfaces', () => {
    const surfaces = [
      readFileSync(new URL('../src/pages/paper/[id].astro', import.meta.url), 'utf8'),
      readFileSync(new URL('../src/pages/abs/[...id].astro', import.meta.url), 'utf8'),
      readFileSync(new URL('../src/pages/admin/moderation.astro', import.meta.url), 'utf8'),
      readFileSync(new URL('../src/components/PaperRow.astro', import.meta.url), 'utf8'),
      readFileSync(new URL('../src/components/PublishButton.tsx', import.meta.url), 'utf8'),
    ];

    for (const source of surfaces) {
      expect(source).toContain('formatPaperStatus');
    }
  });
});
