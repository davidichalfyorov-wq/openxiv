import { afterEach, describe, expect, it } from 'vitest';
import { paperPublicPath, paperPublicUrl } from '../src/lib/paper-url';

const original = process.env['PUBLIC_WEB_BASE'];

afterEach(() => {
  if (original === undefined) delete process.env['PUBLIC_WEB_BASE'];
  else process.env['PUBLIC_WEB_BASE'] = original;
});

describe('paper public URLs', () => {
  it('uses PUBLIC_WEB_BASE for citation-safe public URLs', () => {
    process.env['PUBLIC_WEB_BASE'] = 'https://openxiv.net/';

    expect(
      paperPublicUrl({
        id: '42a4c1dd-4556-427f-a8ec-18c7ae00f7df',
        openxivUrlId: null,
      }),
    ).toBe('https://openxiv.net/paper/42a4c1dd-4556-427f-a8ec-18c7ae00f7df');
  });

  it('prefers canonical /abs URLs after an OpenXiv id is allocated', () => {
    expect(paperPublicPath({ id: 'uuid', openxivUrlId: 'gr-qc.2026.00001' })).toBe(
      '/abs/gr-qc.2026.00001',
    );
  });
});
