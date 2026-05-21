import { describe, expect, it } from 'vitest';
import { validateHandleShape } from '../services/reserved-handles.js';
import { impersonationRisk } from '../services/impersonation.js';

/**
 * Lightweight unit pass for the handle endpoints' input pipeline. The
 * route is exercised end-to-end by the e2e Playwright spec; this file
 * covers the pure validators they delegate to.
 */

describe('handle pipeline reasons', () => {
  it('reserved → reason=reserved', () => {
    const r = validateHandleShape('admin');
    expect(r).toMatchObject({ ok: false, reason: 'reserved' });
  });
  it('did-shape → reason=did_shape', () => {
    expect(validateHandleShape('did:plc:abc')).toMatchObject({ ok: false, reason: 'did_shape' });
  });
  it('valid shape + low risk passes', () => {
    const r = validateHandleShape('alice');
    expect(r).toMatchObject({ ok: true, handle: 'alice' });
    expect(impersonationRisk('alice')).toBe('low');
  });
  it('valid shape + high risk caught by impersonation gate', () => {
    const r = validateHandleShape('admln');
    expect(r).toMatchObject({ ok: true, handle: 'admln' });
    expect(impersonationRisk('admln')).toBe('high');
  });
});
