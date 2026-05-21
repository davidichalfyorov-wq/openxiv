import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('home browse surface', () => {
  it('keeps subject browsing visible from the homepage hero and page body', () => {
    const index = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
    const browseIndex = index.indexOf('<HomeBrowse browse={browse} compact />');
    const featuredIndex = index.indexOf('<FeaturedBlock />');
    const recentIndex = index.indexOf('recent-preprints-shelf');

    expect(index).toContain('href="#browse"');
    expect(index).toContain('Browse subjects');
    expect(index).toContain('home-reference-copy');
    expect(index).toContain('home-reference-paragraph strong');
    expect(index).toContain('OpenXiv is a preprint server that lives in your social feed.');
    expect(index).toContain("You don't have to be in the field to read papers in the field.");
    expect(index).not.toContain('home-hero-sub');
    expect(index).toContain('loadRecentPreprints(client)');
    expect(index).toContain('recent-preprints-shelf');
    expect(index).not.toContain('home-hero-right');
    expect(index).not.toContain('feed-container');
    expect(index).not.toContain('Recent activity');
    expect(index).not.toContain('home-hero-paragraphs');
    expect(browseIndex).toBeGreaterThan(-1);
    expect(featuredIndex).toBeGreaterThan(-1);
    expect(featuredIndex).toBeLessThan(browseIndex);
    expect(recentIndex).toBeGreaterThan(featuredIndex);
    expect(recentIndex).toBeLessThan(browseIndex);
  });

  it('serves direct /browse navigation instead of a 404', () => {
    const browsePageUrl = new URL('../src/pages/browse.astro', import.meta.url);
    const browsePage = readFileSync(browsePageUrl, 'utf8');

    expect(existsSync(browsePageUrl)).toBe(true);
    expect(browsePage).toContain('<HomeBrowse browse={browse} />');
    expect(browsePage).not.toContain('<HomeBrowse browse={browse} compact />');
    expect(browsePage).toContain('categoryBrowse');
  });

  it('renders a bounded home browse module and keeps the full catalog on /browse', () => {
    const homeBrowse = readFileSync(
      new URL('../src/components/HomeBrowse.astro', import.meta.url),
      'utf8',
    );

    expect(homeBrowse).toContain('compact?: boolean');
    expect(homeBrowse).toContain('home-browse-compact');
    expect(homeBrowse).toContain('categoryLimit');
    expect(homeBrowse).toContain('browse-more-link');
    expect(homeBrowse).not.toContain('grid-template-columns: 240px 1fr');
    expect(homeBrowse).not.toContain('height: 380px');
  });
});
