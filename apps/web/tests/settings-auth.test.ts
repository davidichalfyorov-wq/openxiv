import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const settingsProfileSource = readFileSync(
  resolve(process.cwd(), 'src/pages/settings/profile.astro'),
  'utf8',
);
const settingsIdentitySource = readFileSync(
  resolve(process.cwd(), 'src/pages/settings/identity.astro'),
  'utf8',
);

describe('settings auth contract', () => {
  it('redirects anonymous /settings/profile requests to sign-in like other settings tabs', () => {
    expect(settingsProfileSource).toContain(
      "Astro.redirect('/auth/sign-in?return=/settings/profile', 302)",
    );
    expect(settingsProfileSource).not.toContain('Please <a href="/auth/sign-in">sign in</a>');
  });

  it('keeps identity provider controls inside a mobile-safe table wrapper', () => {
    expect(settingsIdentitySource).toContain('identity-table-wrap');
    expect(settingsIdentitySource).toContain('overflow-x: auto');
    expect(settingsIdentitySource).toContain('min-width: 620px');
    expect(settingsIdentitySource).toContain('@media (max-width: 700px)');
  });
});
