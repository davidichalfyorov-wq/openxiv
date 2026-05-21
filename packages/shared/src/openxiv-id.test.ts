import { describe, expect, it } from 'vitest';
import {
  formatOpenxivId,
  openxivIdToUrl,
  parseOpenxivId,
  urlToOpenxivId,
} from './openxiv-id.js';

describe('openxiv id', () => {
  it('formats with zero-padded sequence', () => {
    expect(formatOpenxivId('physics', 2026, 1)).toBe('openxiv:physics.2026.00001');
    expect(formatOpenxivId('hep-th', 2026, 42)).toBe('openxiv:hep-th.2026.00042');
    expect(formatOpenxivId('cs.AI', 2026, 117)).toBe('openxiv:cs.AI.2026.00117');
  });

  it('strips prefix for URL form', () => {
    expect(openxivIdToUrl('openxiv:cs.AI.2026.00117')).toBe('cs.AI.2026.00117');
  });

  it('parses subjects with internal dots', () => {
    const p = parseOpenxivId('openxiv:cs.AI.2026.00117');
    expect(p).toEqual({ subject: 'cs.AI', year: 2026, seq: 117 });
  });

  it('parses URL form too', () => {
    expect(parseOpenxivId('physics.optics.2026.00009')).toEqual({
      subject: 'physics.optics',
      year: 2026,
      seq: 9,
    });
  });

  it('rejects malformed input', () => {
    expect(parseOpenxivId('cs.AI.26.117')).toBeNull();
    expect(parseOpenxivId('physics.2026.1')).toBeNull();
    expect(parseOpenxivId('not-an-id')).toBeNull();
  });

  it('round-trips URL ↔ canonical', () => {
    expect(urlToOpenxivId('hep-th.2026.00042')).toBe('openxiv:hep-th.2026.00042');
  });
});
