import { describe, expect, it } from 'vitest';
import { __testing, FEED_NAMES, FEED_DESCRIPTORS } from './feed-skeleton.js';

describe('feed-skeleton helpers', () => {
  it('clampLimit defaults to 30 when missing or non-numeric', () => {
    expect(__testing.clampLimit(undefined)).toBe(30);
    expect(__testing.clampLimit('not-a-number')).toBe(30);
    expect(__testing.clampLimit(NaN)).toBe(30);
  });

  it('clampLimit clamps to [1, 100]', () => {
    expect(__testing.clampLimit(0)).toBe(1);
    expect(__testing.clampLimit(-5)).toBe(1);
    expect(__testing.clampLimit(1000)).toBe(100);
    expect(__testing.clampLimit('50')).toBe(50);
  });

  it('decodeCursor refuses invalid input', () => {
    expect(__testing.decodeCursor(undefined)).toBe(0);
    expect(__testing.decodeCursor('not-a-number')).toBe(0);
    expect(__testing.decodeCursor('-1')).toBe(0);
  });

  it('decodeCursor caps at the max-offset ceiling', () => {
    expect(__testing.decodeCursor('1000000')).toBe(5000);
    expect(__testing.decodeCursor('123')).toBe(123);
  });
});

describe('feed metadata', () => {
  it('every feed has a descriptor with displayName and description', () => {
    for (const n of FEED_NAMES) {
      const d = FEED_DESCRIPTORS[n];
      expect(d.name).toBe(n);
      expect(d.displayName.length).toBeGreaterThan(3);
      expect(d.description.length).toBeGreaterThan(10);
    }
  });

  it('exposes exactly 6 feeds (matches the spec)', () => {
    expect(FEED_NAMES.length).toBe(6);
  });
});
