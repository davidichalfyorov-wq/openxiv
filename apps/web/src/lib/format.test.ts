import { describe, expect, it } from 'vitest';
import { discloseLabel, discloseToneClass, relativeTime, truncate } from './format.js';

describe('truncate', () => {
  it('returns the string unchanged when shorter than max', () => {
    expect(truncate('abc', 10)).toBe('abc');
  });

  it('uses ellipsis budget when over max', () => {
    expect(truncate('hello world', 5)).toBe('hell…');
  });

  it('returns "" for empty or invalid max', () => {
    expect(truncate('abc', 0)).toBe('');
    expect(truncate('abc', -1)).toBe('');
    expect(truncate('abc', Number.NaN)).toBe('');
  });

  it('does not corrupt surrogate pairs', () => {
    // Two emoji = 2 code points = 4 UTF-16 units. Naive slice(0, 3) would
    // leave a lone high surrogate; we want either both halves of an emoji or none.
    const input = '😀🚀';
    const out = truncate(input, 2);
    expect(out).toBe(input);
    expect(out.length).toBeGreaterThan(0);
    expect(out.codePointAt(0)).toBe(0x1f600);
  });

  it('exact-fit case does not append ellipsis', () => {
    expect(truncate('12345', 5)).toBe('12345');
  });
});

describe('relativeTime', () => {
  const fixed = new Date('2026-05-17T12:00:00Z').getTime();

  it('renders seconds, minutes, hours, days ago', () => {
    expect(relativeTime(new Date(fixed - 5_000).toISOString(), fixed)).toBe('5s ago');
    expect(relativeTime(new Date(fixed - 3 * 60_000).toISOString(), fixed)).toBe('3m ago');
    expect(relativeTime(new Date(fixed - 2 * 3_600_000).toISOString(), fixed)).toBe('2h ago');
    expect(relativeTime(new Date(fixed - 5 * 86_400_000).toISOString(), fixed)).toBe('5d ago');
  });

  it('falls back to a date string past 30 days', () => {
    const out = relativeTime(new Date(fixed - 60 * 86_400_000).toISOString(), fixed);
    expect(out).not.toMatch(/ago/);
    expect(out).not.toBe('—');
  });

  it('renders future timestamps with "in" prefix (clock skew safety)', () => {
    const future = new Date(fixed + 20_000).toISOString();
    expect(relativeTime(future, fixed)).toBe('in 20s');
  });

  it('returns "—" for invalid or empty input', () => {
    expect(relativeTime('', fixed)).toBe('—');
    expect(relativeTime('not-a-date', fixed)).toBe('—');
    expect(relativeTime(undefined as unknown as string, fixed)).toBe('—');
  });
});

describe('disclosure helpers', () => {
  it('return tone classes for every disclosure level (exhaustiveness)', () => {
    expect(discloseToneClass('none')).toBe('badge-tone-neutral');
    expect(discloseToneClass('assistant')).toBe('badge-tone-info');
    expect(discloseToneClass('coauthor')).toBe('badge-tone-warning');
    expect(discloseToneClass('primary')).toBe('badge-tone-caution');
  });

  it('return human labels for every disclosure level', () => {
    expect(discloseLabel('none')).toBe('No AI');
    expect(discloseLabel('assistant')).toBe('AI-assisted');
    expect(discloseLabel('coauthor')).toBe('AI co-author');
    expect(discloseLabel('primary')).toBe('AI-primary');
  });
});
