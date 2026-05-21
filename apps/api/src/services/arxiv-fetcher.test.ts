import { describe, expect, it } from 'vitest';
import { parseArxivAtom } from './arxiv-fetcher.js';

const SAMPLE_PRESENT = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2308.12345v1</id>
    <updated>2026-01-02T00:00:00Z</updated>
    <published>2026-01-01T00:00:00Z</published>
    <title>Sample Paper Title with Special &amp; Characters</title>
    <summary>This is the abstract.
It has multiple lines.</summary>
    <author>
      <name>Alice Author</name>
      <arxiv:affiliation xmlns:arxiv="http://arxiv.org/schemas/atom">MIT</arxiv:affiliation>
    </author>
    <author>
      <name>Bob Author</name>
    </author>
    <link rel="alternate" type="text/html" href="http://arxiv.org/abs/2308.12345v1"/>
    <link title="pdf" rel="related" type="application/pdf" href="http://arxiv.org/pdf/2308.12345v1"/>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
    <category term="stat.ML" scheme="http://arxiv.org/schemas/atom"/>
    <arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">10.1234/example</arxiv:doi>
  </entry>
</feed>`;

const SAMPLE_WITHDRAWN = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/9999.99999v1</id>
    <updated>2026-01-02T00:00:00Z</updated>
    <published>2026-01-01T00:00:00Z</published>
    <title>Withdrawn paper</title>
    <author><name>Single Author</name></author>
    <arxiv:comment xmlns:arxiv="http://arxiv.org/schemas/atom">This paper has been withdrawn by the author.</arxiv:comment>
    <link rel="alternate" type="text/html" href="http://arxiv.org/abs/9999.99999v1"/>
    <category term="hep-th" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>`;

const SAMPLE_NO_ABSTRACT = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/0000.00001v1</id>
    <title>Bare-bones paper</title>
    <author><name>X. Y.</name></author>
    <link title="pdf" rel="related" type="application/pdf" href="http://arxiv.org/pdf/0000.00001v1"/>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="math.AG" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>`;

const SAMPLE_EMPTY = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>http://arxiv.org/api/query?id_list=does.not.exist</id>
  <title>arXiv Query</title>
</feed>`;

describe('parseArxivAtom', () => {
  it('returns null when the feed has no entry', () => {
    expect(parseArxivAtom(SAMPLE_EMPTY, 'does.not.exist')).toBeNull();
  });

  it('parses a full paper — title, abstract, authors, categories, doi', () => {
    const result = parseArxivAtom(SAMPLE_PRESENT, '2308.12345');
    expect(result).not.toBeNull();
    const p = result!.paper;
    expect(p.source).toBe('arxiv');
    expect(p.sourceId).toBe('2308.12345');
    expect(p.title).toBe('Sample Paper Title with Special & Characters');
    expect(p.abstract).toContain('This is the abstract.');
    expect(p.authorsJson).toEqual([
      { name: 'Alice Author', affiliation: 'MIT' },
      { name: 'Bob Author' },
    ]);
    expect(p.categories).toContain('cs.AI');
    expect(p.categories).toContain('stat.ML');
    expect(p.categories?.[0]).toBe('cs.AI'); // primary first
    expect(p.doi).toBe('10.1234/example');
    expect(p.withdrawn).toBe(false);
    expect(result!.withdrawn).toBe(false);
  });

  it('flags a withdrawn paper via the comment hint', () => {
    const result = parseArxivAtom(SAMPLE_WITHDRAWN, '9999.99999');
    expect(result).not.toBeNull();
    expect(result!.withdrawn).toBe(true);
    expect(result!.paper.withdrawn).toBe(true);
  });

  it('flags a paper as withdrawn when no PDF link is offered', () => {
    // SAMPLE_WITHDRAWN has no `<link title="pdf"…` either, so the test
    // doubles as a check of the no-pdf-link heuristic. Build a custom
    // variant to be explicit.
    const noPdf = SAMPLE_PRESENT
      .replace(/<link\s+title="pdf"[\s\S]*?\/>/i, '')
      .replace(/withdrawn/i, '');
    const result = parseArxivAtom(noPdf, '2308.12345');
    expect(result!.withdrawn).toBe(true);
  });

  it('returns null abstract for an entry without <summary>', () => {
    const result = parseArxivAtom(SAMPLE_NO_ABSTRACT, '0000.00001');
    expect(result!.paper.abstract).toBeNull();
    expect(result!.paper.authorsJson).toEqual([{ name: 'X. Y.' }]);
    expect(result!.paper.categories).toEqual(['math.AG']);
  });

  it('decodes XML entities including numeric and hex escapes', () => {
    const xml = SAMPLE_PRESENT.replace(
      '<title>Sample Paper Title with Special &amp; Characters</title>',
      '<title>&#x4E2D;&#25991; — &amp; ldquo;quote&amp;rdquo;</title>',
    );
    const result = parseArxivAtom(xml, '2308.12345');
    expect(result!.paper.title).toContain('中文');
    expect(result!.paper.title).toContain('&');
  });

  it('parses publishedAt to a Date when present', () => {
    const result = parseArxivAtom(SAMPLE_PRESENT, '2308.12345');
    expect(result!.paper.publishedAt).toBeInstanceOf(Date);
    expect((result!.paper.publishedAt as Date).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
