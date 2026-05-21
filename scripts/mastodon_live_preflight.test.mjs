import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMastodonLivePreflightEnv } from './mastodon_live_preflight_lib.mjs';

test('validateMastodonLivePreflightEnv reports missing required live inputs', () => {
  const errors = validateMastodonLivePreflightEnv({});
  assert(errors.includes('missing E2E_OPENXIV_SESSION_COOKIE'));
  assert(errors.includes('missing OPENXIV_HOST'));
  assert(errors.includes('missing OPENXIV_USER'));
  assert(errors.includes('missing OPENXIV_PASSWORD or OPENXIV_KEYFILE'));
});

test('validateMastodonLivePreflightEnv rejects non-production OpenXiv base URL', () => {
  const errors = validateMastodonLivePreflightEnv({
    ...validEnv(),
    E2E_BASE_URL: 'http://localhost:4321',
  });
  assert(errors.includes('E2E_BASE_URL must be https://openxiv.net'));
});

test('validateMastodonLivePreflightEnv accepts complete production inputs', () => {
  assert.deepEqual(validateMastodonLivePreflightEnv(validEnv()), []);
});

test('validateMastodonLivePreflightEnv does not require a separate Mastodon access token', () => {
  const env = validEnv();
  delete env.MASTODON_ACCESS_TOKEN;
  assert.deepEqual(validateMastodonLivePreflightEnv(env), []);
});

function validEnv() {
  return {
    E2E_BASE_URL: 'https://openxiv.net',
    E2E_OPENXIV_SESSION_COOKIE: 'openxiv_session=session-token',
    OPENXIV_HOST: '173.212.216.82',
    OPENXIV_USER: 'root',
    OPENXIV_PASSWORD: 'secret',
  };
}
