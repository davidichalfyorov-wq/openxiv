import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('global UI contract', () => {
  it('keeps legacy component colour tokens mapped to the current design system', () => {
    const globalCss = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');

    expect(globalCss).toContain('--bg-elevated: var(--bg-elev)');
    expect(globalCss).toContain('--text: var(--text-primary)');
    expect(globalCss).toContain('--muted: var(--text-tertiary)');
    expect(globalCss).toContain('--tone-accent: var(--accent)');
    expect(globalCss).toContain('--tone-accent-soft: var(--accent-bg)');
    expect(globalCss).toContain('--danger:');
  });

  it('renders the cookie banner as a compact responsive card instead of a heavy full-width strip', () => {
    const cookieBanner = readFileSync(
      new URL('../src/components/CookieBanner.astro', import.meta.url),
      'utf8',
    );

    expect(cookieBanner).toContain('max-width: min(1080px, calc(100vw - 32px))');
    expect(cookieBanner).toContain('border-radius: var(--radius-md)');
    expect(cookieBanner).toContain('@media (max-width: 640px)');
    expect(cookieBanner).toContain('grid-template-columns: 1fr 1fr');
    expect(cookieBanner).toContain('.consent-accept');
    expect(cookieBanner).toContain('text-decoration: underline');
    expect(cookieBanner).toContain('color: #0e0e10');
    expect(cookieBanner).not.toContain('left: 0; right: 0; bottom: 0;');
    expect(cookieBanner).not.toContain('background: var(--bg-elevated);');
  });

  it('raises mobile dark-theme contrast without changing the desktop theme tokens', () => {
    const globalCss = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');

    expect(globalCss).toContain('@media (max-width: 768px)');
    expect(globalCss).toContain(":root[data-theme='dark']");
    expect(globalCss).toContain('--text-secondary: #b8bec8');
    expect(globalCss).toContain('--text-tertiary: #8d96a3');
    expect(globalCss).toContain('--tone-info: #7aa7f0');
  });

  it('keeps non-critical Google wordmark font from blocking mobile LCP', () => {
    const base = readFileSync(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8');

    expect(base).toContain('fonts.googleapis.com/css2?family=Fraunces');
    expect(base).toContain('rel="preload"');
    expect(base).toContain('as="style"');
    expect(base).toContain('media="(max-width: 768px)"');
    expect(base).toContain('media="(min-width: 769px)"');
    expect(base).toContain('this.rel=');
  });

  it('defaults to the dark reference theme unless a user explicitly picks light', () => {
    const globalCss = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
    const baseLayout = readFileSync(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8');

    expect(globalCss).toContain(":root[data-theme='light']");
    expect(globalCss).not.toContain(':root:not([data-theme])');
    expect(baseLayout).toContain("return 'dark';");
    expect(baseLayout).not.toContain("window.matchMedia('(prefers-color-scheme: light)')");
  });
});
