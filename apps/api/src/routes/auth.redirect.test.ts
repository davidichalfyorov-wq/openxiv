import { describe, expect, it } from 'vitest';
import { sanitizeRedirect, selectBlueskyCallbackMode } from './auth.js';

describe('sanitizeRedirect — open-redirect defence', () => {
  it('returns "/" for empty or non-string input', () => {
    expect(sanitizeRedirect('')).toBe('/');
    expect(sanitizeRedirect(undefined as unknown as string)).toBe('/');
    expect(sanitizeRedirect(null as unknown as string)).toBe('/');
    expect(sanitizeRedirect(123 as unknown as string)).toBe('/');
  });

  it('rejects absolute URLs', () => {
    expect(sanitizeRedirect('http://evil.com')).toBe('/');
    expect(sanitizeRedirect('https://evil.com/x')).toBe('/');
    expect(sanitizeRedirect('javascript:alert(1)')).toBe('/');
    expect(sanitizeRedirect('data:text/html;base64,abc')).toBe('/');
  });

  it('rejects protocol-relative and back-slash variants', () => {
    expect(sanitizeRedirect('//evil.com/path')).toBe('/');
    expect(sanitizeRedirect('/\\evil.com')).toBe('/');
  });

  it('rejects embedded scheme after the leading slash', () => {
    expect(sanitizeRedirect('/javascript:alert(1)')).toBe('/');
    expect(sanitizeRedirect('/data:text/html,xss')).toBe('/');
    expect(sanitizeRedirect('/file:///etc/passwd')).toBe('/');
  });

  it('rejects control characters that browsers may strip', () => {
    expect(sanitizeRedirect('/foo\x00bar')).toBe('/');
    expect(sanitizeRedirect('/foo\nbar')).toBe('/');
    expect(sanitizeRedirect('/foo\rbar')).toBe('/');
  });

  it('caps absurdly long input', () => {
    expect(sanitizeRedirect('/' + 'a'.repeat(3000))).toBe('/');
  });

  it('accepts safe paths', () => {
    expect(sanitizeRedirect('/')).toBe('/');
    expect(sanitizeRedirect('/about')).toBe('/about');
    expect(sanitizeRedirect('/abs/cs.AI.2026.00001')).toBe('/abs/cs.AI.2026.00001');
    expect(sanitizeRedirect('/?q=1&r=2')).toBe('/?q=1&r=2');
    expect(sanitizeRedirect('/@alice')).toBe('/@alice');
  });
});

describe('selectBlueskyCallbackMode', () => {
  it('links only when OAuth state requests link and a primary session is present', () => {
    expect(selectBlueskyCallbackMode({ intent: 'link', hasSession: true })).toBe('link');
    expect(selectBlueskyCallbackMode({ intent: 'link', hasSession: false })).toBe('signin');
    expect(selectBlueskyCallbackMode({ intent: 'signin', hasSession: true })).toBe('signin');
    expect(selectBlueskyCallbackMode({ hasSession: true })).toBe('signin');
  });
});
