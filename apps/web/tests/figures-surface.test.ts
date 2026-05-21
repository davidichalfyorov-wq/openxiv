import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('paper figure surfaces', () => {
  it('renders the figure gallery on both pending and accepted paper pages', () => {
    const pending = readFileSync(new URL('../src/pages/paper/[id].astro', import.meta.url), 'utf8');
    const accepted = readFileSync(
      new URL('../src/pages/abs/[...id].astro', import.meta.url),
      'utf8',
    );

    for (const source of [pending, accepted]) {
      expect(source).toContain('FiguresGallery');
      expect(source).toContain('client.getPaperFigures(paper.id)');
      expect(source).toContain(
        '<FiguresGallery figures={figures} extraction={figureExtraction} />',
      );
    }
  });

  it('keeps extracted figure thumbnails lazy and dimensioned to avoid mobile layout shifts', () => {
    const gallery = readFileSync(
      new URL('../src/components/FiguresGallery.astro', import.meta.url),
      'utf8',
    );

    expect(gallery).toContain('loading="lazy"');
    expect(gallery).toContain('decoding="async"');
    expect(gallery).toContain('width="320"');
    expect(gallery).toContain('height="180"');
  });

  it('keeps figure thumbnails accessible without duplicate image alt text', () => {
    const gallery = readFileSync(
      new URL('../src/components/FiguresGallery.astro', import.meta.url),
      'utf8',
    );

    expect(gallery).toContain('const figureLabel');
    expect(gallery).toContain('aria-label={figureLabel(f)}');
    expect(gallery).toContain('alt=""');
    expect(gallery).toContain('aria-hidden="true"');
    expect(gallery).not.toContain('alt={f.caption ?? `${f.type} ${f.idx + 1}`}');
  });
});
