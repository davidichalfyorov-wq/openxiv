import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PaperPdfCard', () => {
  const source = readFileSync(
    new URL('../src/components/PaperPdfCard.astro', import.meta.url),
    'utf8',
  );

  it('keeps the PDF action rail flush with the preview instead of the full page gutter', () => {
    expect(source).toContain(
      'grid-template-columns: minmax(280px, min(42vw, 402px)) minmax(320px, 488px);',
    );
    expect(source).toContain('justify-content: start;');
  });

  it('uses an object embed for fullscreen PDF viewing so Brave does not block a nested PDF iframe', () => {
    expect(source).toContain('<object');
    expect(source).toContain('class="paper-pdf-fullscreen-frame"');
    expect(source).not.toContain('<iframe');
  });
});
