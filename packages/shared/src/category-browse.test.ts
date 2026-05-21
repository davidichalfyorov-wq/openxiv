import { describe, expect, it } from 'vitest';
import { CATEGORY_GROUPS } from './categories.js';
import { buildCategoryBrowse } from './category-browse.js';

describe('buildCategoryBrowse', () => {
  it('returns every subject group in taxonomy order with per-category counts', () => {
    const browse = buildCategoryBrowse({
      'gr-qc': 2,
      'math-ph': 1,
      'cs.AI': 4,
    });

    expect(browse.groups.map((g) => g.group)).toEqual([...CATEGORY_GROUPS]);
    const physics = browse.groups.find((g) => g.group === 'Physics');
    expect(physics?.paperCount).toBe(3);
    expect(physics?.categories.find((c) => c.code === 'gr-qc')).toMatchObject({
      name: 'General Relativity & Quantum Cosmology',
      paperCount: 2,
      href: '/topics/gr-qc',
    });
    expect(physics?.categories.find((c) => c.code === 'math-ph')?.paperCount).toBe(1);
  });

  it('ignores unknown category codes while preserving the total published count', () => {
    const browse = buildCategoryBrowse({
      'gr-qc': 2,
      'legacy.unknown': 10,
    });

    expect(browse.totalPublished).toBe(2);
    expect(browse.groups.flatMap((g) => g.categories).some((c) => c.code === 'legacy.unknown')).toBe(false);
  });

  it('sorts popular categories by count then code for deterministic homepage rendering', () => {
    const browse = buildCategoryBrowse({
      'math-ph': 3,
      'cs.AI': 5,
      'gr-qc': 5,
      'math.AG': 0,
    });

    expect(browse.popular.map((c) => c.code)).toEqual(['cs.AI', 'gr-qc', 'math-ph']);
  });
});
