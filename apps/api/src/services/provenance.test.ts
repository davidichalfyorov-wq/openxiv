import { describe, expect, it } from 'vitest';
import { buildProvenanceTimeline, type ProvenanceInputs } from './provenance.js';

function paperBase(over: Partial<ProvenanceInputs['loaded']['paper']> = {}): ProvenanceInputs['loaded']['paper'] {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    openxivId: null,
    uri: null,
    cid: null,
    submitterDid: 'did:test:user1',
    title: 'Test paper',
    abstract: 'Abstract',
    license: 'CC-BY-4.0',
    primaryCategory: 'cs.AI',
    doi: null,
    status: 'draft',
    versionNote: null,
    supersedesUri: null,
    submissionTermsVersion: null,
    submissionTermsAcceptedAt: null,
    createdAt: new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-02T00:00:00Z'),
    publishedAt: null,
    ...over,
  } as ProvenanceInputs['loaded']['paper'];
}

function inputs(over: Partial<ProvenanceInputs> = {}): ProvenanceInputs {
  return {
    loaded: {
      paper: paperBase(),
      authors: [],
      categories: [],
      keywords: [],
      latestVersion: null,
      disclosure: null,
      summaries: [],
      detectorScore: null,
    } as unknown as ProvenanceInputs['loaded'],
    sectionsFirstIndexedAt: null,
    bridgeDone: false,
    ...over,
  };
}

describe('buildProvenanceTimeline', () => {
  it('splits PDF and HTML compile stages in canonical order', () => {
    const t = buildProvenanceTimeline(inputs());
    expect(t.stages.map((s) => s.key)).toEqual([
      'uploaded',
      'compiled_pdf',
      'compiled_html',
      'metadata',
      'disclosure',
      'pds',
      'id',
      'indexed',
      'bridged',
    ]);
  });

  it('marks `uploaded` done even on a freshly-created draft', () => {
    const t = buildProvenanceTimeline(inputs());
    const uploaded = t.stages.find((s) => s.key === 'uploaded')!;
    expect(uploaded.done).toBe(true);
    expect(uploaded.completedAt).toBe('2026-05-01T00:00:00.000Z');
  });

  it('shows nothing past `uploaded` for a draft with no relations', () => {
    const t = buildProvenanceTimeline(inputs());
    const done = t.stages.filter((s) => s.done).map((s) => s.key);
    // Metadata is conjunctively gated by authors+categories — with neither
    // set, it must NOT show done. A freshly-uploaded source has nothing.
    expect(done).toEqual(['uploaded']);
    expect(t.completion).toBeCloseTo(1 / 9);
  });

  it('never sets completedAt for a stage that is not yet done', () => {
    const t = buildProvenanceTimeline(inputs());
    for (const stage of t.stages) {
      if (!stage.done) expect(stage.completedAt).toBeNull();
    }
  });

  it('does not mark HTML compiled until html_key exists', () => {
    const t = buildProvenanceTimeline(
      inputs({
        loaded: {
          paper: paperBase(),
          authors: [{ position: 0 } as never],
          categories: ['cs.AI'],
          keywords: [],
          latestVersion: {
            id: 'v1',
            paperId: '11111111-1111-1111-1111-111111111111',
            versionNumber: 1,
            createdAt: new Date('2026-05-01T01:00:00Z'),
            publishedAt: null,
            pdfKey: 'pdf',
            sourceKey: 'src',
            htmlKey: null,
            fileSha256: null,
            sizeBytes: null,
            pageCount: null,
          } as never,
          disclosure: {
            id: 'd1',
            paperId: '11111111-1111-1111-1111-111111111111',
            level: 'assistant',
            aiUsed: [],
            models: [],
            notes: null,
            summaryAiGenerated: false,
            humanVerified: false,
            attestation: 'x',
            uri: null,
            createdAt: new Date('2026-05-01T02:00:00Z'),
          } as never,
          summaries: [],
          detectorScore: null,
        } as never,
      }),
    );
    const done = t.stages.filter((s) => s.done).map((s) => s.key);
    expect(done).toContain('compiled_pdf');
    expect(done).not.toContain('compiled_html');
    expect(done).toContain('metadata');
    expect(done).toContain('disclosure');
    expect(done).not.toContain('id');
    expect(done).not.toContain('indexed');
  });

  it('marks `pds` done only when uri starts with at://', () => {
    const withUri = buildProvenanceTimeline(
      inputs({
        loaded: {
          paper: paperBase({ uri: 'at://did:example/app.openxiv.paper/abc' }),
          authors: [],
          categories: [],
          keywords: [],
          latestVersion: null,
          disclosure: null,
          summaries: [],
          detectorScore: null,
        } as never,
      }),
    );
    expect(withUri.stages.find((s) => s.key === 'pds')!.done).toBe(true);

    const withBogusUri = buildProvenanceTimeline(
      inputs({
        loaded: {
          paper: paperBase({ uri: 'https://not-pds.example/x' }),
          authors: [],
          categories: [],
          keywords: [],
          latestVersion: null,
          disclosure: null,
          summaries: [],
          detectorScore: null,
        } as never,
      }),
    );
    expect(withBogusUri.stages.find((s) => s.key === 'pds')!.done).toBe(false);
  });

  it('marks `indexed` done when sectionsFirstIndexedAt is provided', () => {
    const t = buildProvenanceTimeline(
      inputs({ sectionsFirstIndexedAt: new Date('2026-05-03T00:00:00Z') }),
    );
    const ix = t.stages.find((s) => s.key === 'indexed')!;
    expect(ix.done).toBe(true);
    expect(ix.completedAt).toBe('2026-05-03T00:00:00.000Z');
  });

  it('marks `bridged` done from saga bit; surfaces completedAt as null', () => {
    const t = buildProvenanceTimeline(inputs({ bridgeDone: true }));
    const bridged = t.stages.find((s) => s.key === 'bridged')!;
    expect(bridged.done).toBe(true);
    // We deliberately do NOT fake a timestamp — saga has no per-stage
    // wall-clock. The UI must render this as "done" without a date.
    expect(bridged.completedAt).toBeNull();
  });

  it('completion is monotone non-decreasing as more inputs flip true', () => {
    const t0 = buildProvenanceTimeline(inputs()).completion;
    const t1 = buildProvenanceTimeline(inputs({ bridgeDone: true })).completion;
    const t2 = buildProvenanceTimeline(
      inputs({ bridgeDone: true, sectionsFirstIndexedAt: new Date() }),
    ).completion;
    expect(t1).toBeGreaterThan(t0);
    expect(t2).toBeGreaterThan(t1);
  });
});
