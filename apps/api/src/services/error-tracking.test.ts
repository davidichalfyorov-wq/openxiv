import { describe, expect, it } from 'vitest';
import { shouldSkipErrorTracking } from './error-tracking.js';

describe('error tracking privacy gate', () => {
  it('skips capture when browser DNT or GPC is present', () => {
    expect(shouldSkipErrorTracking({ dnt: '1' })).toBe(true);
    expect(shouldSkipErrorTracking({ 'do-not-track': '1' })).toBe(true);
    expect(shouldSkipErrorTracking({ 'sec-gpc': '1' })).toBe(true);
  });

  it('skips capture when the OpenXiv opt-out cookie is present', () => {
    expect(shouldSkipErrorTracking({ cookie: 'a=1; openxiv_notrack=1; b=2' })).toBe(true);
  });

  it('allows capture when no opt-out signal exists', () => {
    expect(shouldSkipErrorTracking({ cookie: 'openxiv_consent=abc' })).toBe(false);
  });
});
