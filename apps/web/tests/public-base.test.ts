import { afterEach, describe, expect, it } from 'vitest';
import { publicWebBase } from '../src/lib/public-base';

const original = process.env['PUBLIC_WEB_BASE'];

afterEach(() => {
  if (original === undefined) delete process.env['PUBLIC_WEB_BASE'];
  else process.env['PUBLIC_WEB_BASE'] = original;
});

describe('publicWebBase', () => {
  it('prefers runtime PUBLIC_WEB_BASE so production SSR feeds do not fall back to localhost', () => {
    process.env['PUBLIC_WEB_BASE'] = 'https://openxiv.net/';
    expect(publicWebBase()).toBe('https://openxiv.net');
  });

  it('falls back to localhost only when no runtime or build-time base is configured', () => {
    delete process.env['PUBLIC_WEB_BASE'];
    expect(publicWebBase(undefined)).toBe('http://localhost:4321');
  });
});
