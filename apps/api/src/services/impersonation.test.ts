import { describe, expect, it } from 'vitest';
import {
  confusableSkeleton,
  impersonationRisk,
  levenshtein,
  __testing,
} from './impersonation.js';

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('admin', 'admin')).toBe(0);
  });
  it('counts a single substitution', () => {
    expect(levenshtein('admin', 'admon')).toBe(1);
  });
  it('counts insertions + deletions', () => {
    expect(levenshtein('admin', 'amin')).toBe(1);
    expect(levenshtein('admin', 'addmin')).toBe(1);
  });
  it('symmetric', () => {
    expect(levenshtein('alpha', 'beta')).toBe(levenshtein('beta', 'alpha'));
  });
});

describe('confusableSkeleton', () => {
  it('folds digit homoglyphs', () => {
    expect(confusableSkeleton('0p3nx1v')).toBe('openxlv');
  });
  it('folds Cyrillic lookalikes', () => {
    // 'оpenxiv' starts with Cyrillic о (U+043E) — should fold to 'openxiv'.
    expect(confusableSkeleton('оpenxiv')).toBe('openxiv');
  });
  it('strips non-alphanumerics', () => {
    expect(confusableSkeleton('a.d-m_i n')).toBe('admin');
  });
});

describe('impersonationRisk', () => {
  it('flags exact matches as high', () => {
    expect(impersonationRisk('admin')).toBe('high');
    expect(impersonationRisk('openxiv')).toBe('high');
    expect(impersonationRisk('ddavidich')).toBe('high');
  });

  it('flags distance-1 typosquats as high', () => {
    expect(impersonationRisk('admon')).toBe('high'); // admin
    expect(impersonationRisk('openxiu')).toBe('high'); // openxiv
    expect(impersonationRisk('davidalfyoroy')).toBe('high'); // davidalfyorov
  });

  it('flags homoglyph attacks as high', () => {
    // Cyrillic а in admin
    expect(impersonationRisk('аdmin')).toBe('high');
    // 0p3nx1v style
    expect(impersonationRisk('0p3nxiv')).toBe('high');
  });

  it('clears distinct, common words as low', () => {
    expect(impersonationRisk('alice')).toBe('low');
    expect(impersonationRisk('phys-grad')).toBe('low');
    expect(impersonationRisk('researcher42')).toBe('low');
    expect(impersonationRisk('mountain')).toBe('low');
  });

  it('30+ adversarial cases all flag high', () => {
    const adversarial = [
      'admin',
      'admln',
      'admin1',
      'admin_',
      'admln1',
      '_admin',
      'ad_min',
      'adminn',
      'adminx',
      'admon',
      'аdmin',
      'аdmln',
      'adm1n',
      '0penxiv',
      'openxlv',
      'openxiu',
      '0p3nx1v',
      'оpenxiv',
      'mod1',
      'mod_',
      'modd',
      'm0d',
      'support1',
      's_upport',
      'supp0rt',
      'staff_',
      'staff1',
      'staffx',
      'officlal',
      'official_',
      'ddavidich1',
      'ddavidlch',
      'davidich_',
      'davldich',
      'davidalfyorov_',
      'davidalfyoroy',
    ];
    for (const a of adversarial) {
      expect(impersonationRisk(a)).toBe('high');
    }
    expect(adversarial.length).toBeGreaterThanOrEqual(30);
  });

  it('50+ legitimate handles all clear as low', () => {
    const legit = [
      'alice',
      'bob',
      'carol',
      'dan',
      'eve',
      'frank',
      'grace',
      'heidi',
      'ivan',
      'judy',
      'mallory',
      'oscar',
      'peggy',
      'rupert',
      'trent',
      'victor',
      'walter',
      'wendy',
      'xavier',
      'yara',
      'zara',
      'researcher1',
      'researcher42',
      'physgrad',
      'phys-grad',
      'phys.grad',
      'bio-major',
      'cosmologist',
      'ecologist',
      'mathlover',
      'codepoet',
      'data-nerd',
      'compsci',
      'astro-x',
      'paleo-pat',
      'micro-bee',
      'plasma-q',
      'quanta42',
      'kepler-x',
      'darwin-y',
      'curie-z',
      'feynman1',
      'hawkings',
      'einstein9',
      'turing-7',
      'gauss-4',
      'galileo3',
      'newton-21',
      'lovelace8',
      'noether-w',
      'meitner-v',
    ];
    for (const h of legit) {
      expect(impersonationRisk(h)).toBe('low');
    }
    expect(legit.length).toBeGreaterThanOrEqual(50);
  });
});

void __testing;
