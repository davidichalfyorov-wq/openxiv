import { describe, expect, it } from 'vitest';
import { decodeOrcidState, makeOrcidOAuthClient } from './orcid.js';

describe('makeOrcidOAuthClient', () => {
  it('uses identity-only ORCID scope for link flows', async () => {
    const client = makeOrcidOAuthClient({
      clientId: 'APP-TEST',
      clientSecret: 'secret',
      redirectUri: 'https://openxiv.net/auth/orcid/callback',
      useSandbox: false,
    });

    const result = await client.authorizeUrl('/settings/identity', { intent: 'link' });

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    const url = new URL(value.url);
    expect(url.searchParams.get('scope')).toBe('/authenticate');
    expect(url.searchParams.get('scope')).not.toContain('/activities/update');
    expect(decodeOrcidState(value.state)).toMatchObject({
      intent: 'link',
      redirectAfter: '/settings/identity',
      scope: '/authenticate',
    });
  });
});
