import { describe, expect, it } from 'vitest';
import { __testing } from './client.js';

describe('Bluesky OAuth callback state', () => {
  it('round-trips redirect target and link intent', () => {
    const encoded = __testing.encodeCallbackState({
      redirectAfter: '/settings/identity',
      intent: 'link',
    });

    expect(__testing.parseCallbackState(encoded)).toEqual({
      redirectAfter: '/settings/identity',
      intent: 'link',
    });
  });

  it('drops invalid state instead of throwing', () => {
    expect(__testing.parseCallbackState('not-base64url-json')).toEqual({});
  });
});
