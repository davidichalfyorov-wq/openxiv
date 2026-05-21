import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Trust Passport web surface', () => {
  it('exposes full passport viewer and raw JSON-LD download routes', () => {
    const api = readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
    const abs = readFileSync(new URL('../src/pages/abs/[...id].astro', import.meta.url), 'utf8');
    const trustPanel = readFileSync(
      new URL('../src/components/TrustPanel.astro', import.meta.url),
      'utf8',
    );

    expect(api).toContain('getPaperPassport');
    expect(api).toContain('verifyPaperPassport');
    expect(api).toContain('createPassportDispute');
    expect(api).toContain('createPassportDisputeResponse');
    expect(api).toContain('semanticDigest');
    expect(existsSync(new URL('../src/pages/abs/[id]/passport.astro', import.meta.url))).toBe(true);
    expect(existsSync(new URL('../src/pages/abs/[id]/passport.json.ts', import.meta.url))).toBe(
      true,
    );
    expect(existsSync(new URL('../src/pages/abs/[id]/passport/dispute.ts', import.meta.url))).toBe(
      true,
    );
    expect(
      existsSync(new URL('../src/pages/abs/[id]/passport/dispute-response.ts', import.meta.url)),
    ).toBe(true);
    expect(existsSync(new URL('../src/pages/abs/[id]/passport/verify.ts', import.meta.url))).toBe(
      true,
    );
    expect(abs).toContain('/passport');
    const passportPage = readFileSync(
      new URL('../src/pages/abs/[id]/passport.astro', import.meta.url),
      'utf8',
    );
    expect(passportPage).toContain('passport/verify');
    expect(passportPage).toContain('name="baselineDigest"');
    expect(passportPage).toContain('name="baselinePassport"');
    expect(passportPage).toContain('verifyChangedLanes');
    expect(passportPage).toContain('passport-verify-delta');
    expect(passportPage).toContain('changed lane');
    expect(passportPage).toContain('laneHistoryStateLabels');
    expect(passportPage).toContain('verifiedExternalAttestationCount');
    expect(passportPage).toContain('highlightedDisputeCount');
    expect(passportPage).toContain('signature verified');
    expect(passportPage).toContain('passport/dispute-response');
    expect(passportPage).toContain('name="disputeId"');
    expect(passportPage).toContain('passport-snippet');
    expect(passportPage).toContain('item.category');
    expect(passportPage).toContain('item.snippet');
    expect(passportPage).toContain('href={`${absPath}#${item.anchor}`}');
    expect(passportPage).toContain('Trust history');
    expect(passportPage).toContain('passport.history');
    expect(passportPage).toContain('passport-timeline');
    expect(passportPage).toContain('Evidence summary');
    expect(passportPage).toContain('check.summary');
    expect(passportPage).not.toContain('confidence {check.confidence}%');
    const verifyRoute = readFileSync(
      new URL('../src/pages/abs/[id]/passport/verify.ts', import.meta.url),
      'utf8',
    );
    expect(verifyRoute).toContain('baselinePassport');
    expect(verifyRoute).toContain('changedLanes');
    expect(verifyRoute).toContain('publicDisputeDelta');
    expect(verifyRoute).toContain('externalAttestationDelta');
    expect(
      existsSync(new URL('../src/pages/abs/[id]/passport/dispute-status.ts', import.meta.url)),
    ).toBe(true);
    expect(passportPage).toContain('disputeStatusPath');
    expect(passportPage).toContain('Mark resolved');
    expect(passportPage).toContain('Highlight');
    expect(passportPage).toContain('Citations');
    expect(passportPage).toContain('Math');
    expect(trustPanel).toContain('Full passport');
    expect(trustPanel).toContain('Citations');
    expect(trustPanel).toContain('Math');
    expect(trustPanel).toContain('Evidence summary');
    expect(trustPanel).not.toContain('role="list"');
    expect(trustPanel).not.toContain('role="listitem"');
    expect(trustPanel).toContain('overflow: hidden');
    expect(trustPanel).toContain('minmax(0, 1fr)');
    expect(trustPanel).toContain('overflow-wrap: anywhere');
    expect(trustPanel).not.toContain('<span class="muted">score {entry.lane.score}</span>');
    expect(trustPanel).not.toContain('confidence {entry.lane.confidence}');
    expect(trustPanel).not.toContain('Four signals');
  });

  it('allows disputes on every passport lane including citations and math', () => {
    const disputeRoute = readFileSync(
      new URL('../src/pages/abs/[id]/passport/dispute.ts', import.meta.url),
      'utf8',
    );

    expect(disputeRoute).toContain("'provenance'");
    expect(disputeRoute).toContain("'citations'");
    expect(disputeRoute).toContain("'math'");
  });
});

describe('HTML-first paper page', () => {
  it('renders HTML inline as the primary reading surface and keeps PDF as a source link', () => {
    const abs = readFileSync(new URL('../src/pages/abs/[...id].astro', import.meta.url), 'utf8');

    expect(abs).toContain('paper-reader-shell');
    expect(abs).toContain('paper-inline-html');
    expect(abs).toContain('postProcessPaperHtml');
    expect(abs).toContain('Source PDF');
    expect(abs).not.toContain('paper-html-frame');
    expect(abs).not.toContain('embeddedReaderPath');
    expect(abs).not.toContain('title="PDF preview"');
  });

  it('prevents paper-side utility panels from overflowing the viewport', () => {
    const abs = readFileSync(new URL('../src/pages/abs/[...id].astro', import.meta.url), 'utf8');

    expect(abs).toContain('.paper-reader-shell');
    expect(abs).toContain('.paper-reader-side');
    expect(abs).toContain('minmax(0, 1fr) minmax(460px, 520px)');
    expect(abs).toContain('.onehard-card');
    expect(abs).toContain('overflow-wrap: anywhere');
    expect(abs).toContain('min-width: 0');
  });

  it('keeps paper-side cards responsive without metadata clipping', () => {
    const aiUsage = readFileSync(
      new URL('../src/components/AIUsageCard.astro', import.meta.url),
      'utf8',
    );
    const trustPanel = readFileSync(
      new URL('../src/components/TrustPanel.astro', import.meta.url),
      'utf8',
    );
    const endorsements = readFileSync(
      new URL('../src/components/EndorsementsPanel.astro', import.meta.url),
      'utf8',
    );
    const abs = readFileSync(new URL('../src/pages/abs/[...id].astro', import.meta.url), 'utf8');

    for (const source of [aiUsage, trustPanel, endorsements]) {
      expect(source).not.toContain('text-overflow: ellipsis');
      expect(source).not.toContain('white-space: nowrap');
    }
    expect(abs).not.toContain('text-overflow: ellipsis');
    expect(aiUsage).toContain('clamp(');
    expect(aiUsage).toContain('overflow-wrap: anywhere');
    expect(trustPanel).toContain('clamp(');
    expect(trustPanel).toContain('line-height: 1.5');
    expect(endorsements).toContain('overflow-wrap: anywhere');
    expect(endorsements).toContain('min-height: 44px');
    expect(abs).toContain('.artifact-card');
    expect(abs).toContain('clamp(');
  });

  it('defers below-the-fold explainer hydration and keeps tab ARIA valid', () => {
    const abs = readFileSync(new URL('../src/pages/abs/[...id].astro', import.meta.url), 'utf8');
    const explainer = readFileSync(
      new URL('../src/components/Explainer.tsx', import.meta.url),
      'utf8',
    );

    expect(abs).toContain('<Explainer client:visible');
    expect(abs).not.toContain('<Explainer client:load');
    expect(explainer).toContain('role="tab"');
    expect(explainer).toContain('aria-selected={t === tier}');
  });

  it('lets paper metadata own the canonical link instead of rendering duplicate canonicals', () => {
    const base = readFileSync(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8');
    const abs = readFileSync(new URL('../src/pages/abs/[...id].astro', import.meta.url), 'utf8');

    expect(base).toContain('canonicalUrl?: string | false');
    expect(base).toContain('canonicalHref &&');
    expect(abs).toContain('canonicalUrl={false}');
  });

  it('keeps optional version changelog data from breaking the paper page', () => {
    const changelog = readFileSync(
      new URL('../src/components/VersionChangelog.astro', import.meta.url),
      'utf8',
    );

    expect(changelog).toContain('Array.isArray(data?.items)');
    expect(changelog).toContain('versionItems.map');
  });

  it('keeps optional seminar discussion data from breaking the paper page', () => {
    const seminar = readFileSync(
      new URL('../src/components/SeminarThread.astro', import.meta.url),
      'utf8',
    );

    expect(seminar).toContain('Array.isArray(data?.items)');
    expect(seminar).toContain('discussionItems.map');
  });

  it('keeps optional endorsement data from breaking the paper page', () => {
    const endorsements = readFileSync(
      new URL('../src/components/EndorsementsPanel.astro', import.meta.url),
      'utf8',
    );

    expect(endorsements).toContain('Array.isArray(data?.items)');
    expect(endorsements).toContain('endorsementItems.slice');
  });
});
