import { describe, expect, it } from 'vitest';
import {
  makeHeuristicDetector,
  makeMockCompiler,
  makeMockGrobidExtractor,
  makeMockLatexmlConverter,
  makeMockLlmClient,
  makeMockOAuthClient,
  makeMockPdsClient,
  makeMockStorageClient,
  makeTfidfKeywordExtractor,
} from './index.js';

describe('mock storage', () => {
  it('round-trips an object', async () => {
    const s = makeMockStorageClient();
    const put = await s.put('a/b.txt', Buffer.from('hi'), { contentType: 'text/plain' });
    expect(put.isOk()).toBe(true);
    const get = await s.get('a/b.txt');
    expect(get.isOk()).toBe(true);
    if (get.isOk()) {
      expect(get.value.body.toString()).toBe('hi');
      expect(get.value.contentType).toBe('text/plain');
    }
  });
});

describe('mock compiler', () => {
  it('returns a stub PDF', async () => {
    const c = makeMockCompiler();
    const r = await c.compile({ source: Buffer.from('\\documentclass{article}'), filename: 'main.tex' });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.pdf.subarray(0, 5).toString()).toBe('%PDF-');
    }
  });
});

describe('mock grobid', () => {
  it('returns shaped metadata', async () => {
    const g = makeMockGrobidExtractor();
    const r = await g.extract(Buffer.from('pdf'));
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.authors.length).toBeGreaterThan(0);
      expect(r.value.title).toBeDefined();
    }
  });
});

describe('mock latexml', () => {
  it('returns HTML', async () => {
    const l = makeMockLatexmlConverter();
    const r = await l.convertToHtml({ source: Buffer.from('x'), filename: 'main.tex' });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.html.toString()).toMatch(/<html/);
    }
  });

  it('renders source-derived HTML for TeX instead of a stub page', async () => {
    const l = makeMockLatexmlConverter();
    const r = await l.convertToHtml({
      source: Buffer.from(String.raw`
\documentclass{article}
\title{Source-derived paper}
\author{Alice Example}
\begin{document}
\maketitle
\begin{abstract}
This abstract comes from the TeX source.
\end{abstract}
\section{Introduction}
This paragraph should appear in the reader.
\end{document}
`),
      filename: 'paper.tex',
    });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      const html = r.value.html.toString();
      expect(html).toContain('<h1>Source-derived paper</h1>');
      expect(html).toContain('Alice Example');
      expect(html).toContain('This abstract comes from the TeX source.');
      expect(html).toContain('This paragraph should appear in the reader.');
      expect(html).not.toContain('Stub HTML render');
    }
  });
});

describe('heuristic detector', () => {
  it('scores text in [0, 100]', async () => {
    const d = makeHeuristicDetector();
    const r = await d.score('Some text. More text. Yet another sentence. The end.', {
      burst: 0.4,
      binoculars: 0.4,
      stylometric: 0.2,
    });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.score).toBeGreaterThanOrEqual(0);
      expect(r.value.score).toBeLessThanOrEqual(100);
    }
  });
});

describe('tfidf keywords', () => {
  it('extracts plausible terms', async () => {
    const k = makeTfidfKeywordExtractor();
    const text = `Quantum entanglement plays a critical role in quantum networks.
                  Networks built on entanglement can outperform classical channels.
                  Entanglement distribution is the central protocol.`;
    const r = await k.extract(text, { max: 5 });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toContain('entanglement');
      expect(r.value.length).toBeLessThanOrEqual(5);
    }
  });
});

describe('mock oauth', () => {
  it('round-trips authorize → exchange and preserves the embedded profile shape', async () => {
    const o = makeMockOAuthClient('orcid');
    const url = await o.authorizeUrl();
    expect(url.isOk()).toBe(true);
    if (!url.isOk()) return;

    // The mock builds a per-call randomised profile and encodes it into `code`.
    // The round-trip must decode the *same* profile we encoded — that's the
    // contract any real OAuth client guarantees too.
    const parsed = new URL(url.value.url, 'http://x');
    expect(parsed.pathname).toBe('/auth/dev/mock-callback');
    expect(parsed.searchParams.get('provider')).toBe('orcid');
    const code = parsed.searchParams.get('code')!;
    expect(code.length).toBeGreaterThan(0);

    const profile = await o.exchange({ code, state: url.value.state });
    expect(profile.isOk()).toBe(true);
    if (!profile.isOk()) return;
    expect(profile.value.provider).toBe('orcid');
    // The mock no longer hard-codes a specific orcid — that would let a
    // mistakenly-enabled mock impersonate a real identity. We assert the
    // shape only.
    expect(profile.value.subject).toMatch(/^mock-orcid-/);
    expect(profile.value.displayName).toMatch(/Mock orcid user/);
  });

  it('exchange with malformed code falls back to a stable shape', async () => {
    const o = makeMockOAuthClient('google');
    const profile = await o.exchange({ code: 'this-is-not-base64-json', state: 'whatever' });
    expect(profile.isOk()).toBe(true);
    if (!profile.isOk()) return;
    expect(profile.value.provider).toBe('google');
    expect(profile.value.subject).toMatch(/^mock-google-/);
  });
});

describe('mock pds', () => {
  it('persists a put and reads back', async () => {
    const p = makeMockPdsClient();
    const did = 'did:plc:abcdefghijklmnopqrstuvwx';
    const put = await p.putRecord({
      repo: did,
      collection: 'app.openxiv.post',
      record: { text: 'hi', createdAt: new Date().toISOString() },
    });
    expect(put.isOk()).toBe(true);
    if (put.isOk()) {
      const read = await p.getRecord({ uri: put.value.uri });
      expect(read.isOk()).toBe(true);
    }
  });
});

describe('mock llm', () => {
  it('generates deterministic embeddings', async () => {
    const l = makeMockLlmClient();
    const r1 = await l.generateEmbedding('hello world');
    const r2 = await l.generateEmbedding('hello world');
    expect(r1.isOk() && r2.isOk()).toBe(true);
    if (r1.isOk() && r2.isOk()) {
      expect(r1.value).toEqual(r2.value);
      expect(r1.value).toHaveLength(768);
    }
  });
});
