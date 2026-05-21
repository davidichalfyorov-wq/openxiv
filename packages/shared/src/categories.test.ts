import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  CATEGORY_CODES,
  CATEGORY_GROUPS,
  categoryPrefix,
  getCategory,
  groupCategories,
  isCategoryCode,
} from './categories.js';

describe('category taxonomy invariants', () => {
  it('contains at least one category per declared group', () => {
    const seen = new Set(CATEGORIES.map((c) => c.group));
    for (const group of CATEGORY_GROUPS) {
      expect(seen.has(group)).toBe(true);
    }
  });

  it('every category code is unique', () => {
    const set = new Set<string>();
    for (const code of CATEGORY_CODES) {
      expect(set.has(code)).toBe(false);
      set.add(code);
    }
  });

  it('every category code passes basic shape (slug + optional dotted suffix)', () => {
    for (const c of CATEGORIES) {
      // Allow letters, digits, dot and hyphen. No spaces. Reasonable length cap.
      expect(c.code).toMatch(/^[a-z0-9][a-z0-9.\-]{0,32}$/i);
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.name.length).toBeLessThan(120);
    }
  });

  it('isCategoryCode and getCategory agree', () => {
    for (const c of CATEGORIES) {
      expect(isCategoryCode(c.code)).toBe(true);
      expect(getCategory(c.code)?.code).toBe(c.code);
    }
    expect(isCategoryCode('this.is.not.a.real.code')).toBe(false);
    expect(getCategory('this.is.not.a.real.code')).toBeUndefined();
  });

  it('groupCategories preserves order and groups membership exhaustively', () => {
    const grouped = groupCategories();
    const flattened = CATEGORY_GROUPS.flatMap((g) => grouped[g]);
    expect(flattened).toHaveLength(CATEGORIES.length);
    expect(flattened.map((c) => c.code)).toEqual(CATEGORIES.map((c) => c.code));
  });

  it('categoryPrefix returns top-level slug for dotted and undotted codes', () => {
    expect(categoryPrefix('cs.LG')).toBe('cs');
    expect(categoryPrefix('physics.optics')).toBe('physics');
    expect(categoryPrefix('gr-qc')).toBe('gr-qc');
    expect(categoryPrefix('anthro')).toBe('anthro');
  });

  it('taxonomy covers the disciplines we promised — sanity check on the big ones', () => {
    const codes = new Set(CATEGORY_CODES);
    for (const c of ['cs.AI', 'cs.LG', 'math.AG', 'q-bio.NC', 'bio.neuro', 'chem.org', 'med.epi', 'earth.atm', 'psy.cog', 'hum.phil', 'soc.gen', 'eess.SP', 'eng.mech']) {
      expect(codes.has(c)).toBe(true);
    }
  });
});
