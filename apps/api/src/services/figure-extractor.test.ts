import { describe, expect, it } from 'vitest';
import { __testing } from './figure-extractor.js';

const {
  parseFigureBlocks,
  parseCaptionedFigureBlocks,
  parsePdfTextLayout,
  inferGraphicBboxAboveCaption,
  parseCoords,
} = __testing;

describe('parseCoords', () => {
  it('parses a 5-tuple "P,X,Y,W,H" in PDF user-space points', () => {
    expect(parseCoords('3,142.0,531.0,310.5,180.7')).toEqual({
      p: 3,
      x: 142.0,
      y: 531.0,
      w: 310.5,
      h: 180.7,
    });
  });

  it('rejects negative widths or pages < 1', () => {
    expect(parseCoords('0,10,10,10,10')).toBeNull();
    expect(parseCoords('1,10,10,0,10')).toBeNull();
    expect(parseCoords('1,10,10,10,-1')).toBeNull();
  });

  it('rejects malformed input (too few parts, NaN)', () => {
    expect(parseCoords('1,10,10,10')).toBeNull();
    expect(parseCoords('hi,no,coords')).toBeNull();
    expect(parseCoords('1,NaN,10,10,10')).toBeNull();
  });

  it('floors the page number to an integer', () => {
    expect(parseCoords('2.4,10,10,10,10')?.p).toBe(2);
  });
});

describe('parseFigureBlocks', () => {
  it('returns an empty array for TEI with no figures', () => {
    const tei = `<TEI><text><body><p>Just words.</p></body></text></TEI>`;
    expect(parseFigureBlocks(tei)).toEqual([]);
  });

  it('extracts a basic <figure> with <graphic coords>', () => {
    const tei = `
      <figure xml:id="fig_0">
        <head>Figure 1</head>
        <figDesc>Caption text here.</figDesc>
        <graphic coords="3,142.0,531.0,310.5,180.7"/>
      </figure>`;
    const out = parseFigureBlocks(tei);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'figure',
      caption: 'Caption text here.',
      bbox: { p: 3, x: 142.0, y: 531.0, w: 310.5, h: 180.7 },
    });
  });

  it('prefers <graphic coords> over the element-level coords', () => {
    const tei = `
      <figure coords="3,10,10,500,500">
        <figDesc>cap</figDesc>
        <graphic coords="3,100,100,200,200"/>
      </figure>`;
    const out = parseFigureBlocks(tei);
    expect(out[0]?.bbox).toEqual({ p: 3, x: 100, y: 100, w: 200, h: 200 });
  });

  it('falls back to element-level coords when no <graphic> coords is present', () => {
    const tei = `<figure coords="2,11,12,13,14"><figDesc>x</figDesc></figure>`;
    const out = parseFigureBlocks(tei);
    expect(out[0]?.bbox).toEqual({ p: 2, x: 11, y: 12, w: 13, h: 14 });
  });

  it('treats <table> as type=table', () => {
    const tei = `<table coords="1,10,10,100,100"><head>T1</head></table>`;
    const out = parseFigureBlocks(tei);
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe('table');
  });

  it('honours <figure type="table"> as a table', () => {
    const tei = `<figure type="table" coords="1,1,1,1,1"><head>T</head></figure>`;
    expect(parseFigureBlocks(tei)[0]?.type).toBe('table');
  });

  it('takes the first coord group when figures carry semicolon-split coords', () => {
    const tei = `<figure><graphic coords="4,10,20,30,40;4,200,20,30,40"/></figure>`;
    const out = parseFigureBlocks(tei);
    expect(out[0]?.bbox).toEqual({ p: 4, x: 10, y: 20, w: 30, h: 40 });
  });

  it('skips figures with no coordinates at all', () => {
    const tei = `<figure><head>No coords</head><figDesc>missing</figDesc></figure>`;
    expect(parseFigureBlocks(tei)).toEqual([]);
  });

  it('decodes XML entities in captions', () => {
    const tei = `<figure coords="1,1,1,1,1"><figDesc>A &amp; B &lt; C</figDesc></figure>`;
    expect(parseFigureBlocks(tei)[0]?.caption).toBe('A & B < C');
  });

  it('strips nested tags from <figDesc>', () => {
    const tei = `<figure coords="1,1,1,1,1"><figDesc>Hello <ref>[1]</ref> world.</figDesc></figure>`;
    expect(parseFigureBlocks(tei)[0]?.caption).toBe('Hello [1] world.');
  });

  it('falls back to <head> when <figDesc> is missing', () => {
    const tei = `<figure coords="1,1,1,1,1"><head>Just a head</head></figure>`;
    expect(parseFigureBlocks(tei)[0]?.caption).toBe('Just a head');
  });

  it('handles multiple figures in order', () => {
    const tei = `
      <figure coords="1,10,10,10,10"><head>A</head></figure>
      <figure coords="2,20,20,20,20"><head>B</head></figure>
      <table coords="3,30,30,30,30"><head>C</head></table>
    `;
    const out = parseFigureBlocks(tei);
    expect(out.map((f) => f.bbox.p)).toEqual([1, 2, 3]);
    expect(out.map((f) => f.type)).toEqual(['figure', 'figure', 'table']);
  });
});

describe('caption-anchored PDF crops', () => {
  it('keeps only real figure captions from GROBID caption-only blocks', () => {
    const tei = `
      <figure coords="6,70,400,450,10;6,70,415,250,10">
        <head>Figure 1 :</head>
        <label>1</label>
        <figDesc>Figure 1: Logical structure.</figDesc>
      </figure>
      <figure coords="8,70,608,450,10">
        <head>Theorem 2 . 5 (</head>
        <label>25</label>
        <figDesc>Smooth-window convergence).</figDesc>
      </figure>
    `;

    const out = parseCaptionedFigureBlocks(tei);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      caption: 'Figure 1: Logical structure.',
      captionBbox: { p: 6, x: 70, y: 400, w: 450, h: 25 },
      type: 'figure',
    });
  });

  it('infers a padded figure crop above the caption and ignores page furniture', () => {
    const layout = parsePdfTextLayout(`
      <page width="595.28" height="841.89">
        <block xMin="16" yMin="310" xMax="24" yMax="530"><line><word>openxiv:side</word></line></block>
        <block xMin="208" yMin="74" xMax="333" yMax="88"><line><word>Bare</word></line></block>
        <block xMin="273" yMin="97" xMax="319" yMax="105"><line><word>non-coercive</word></line></block>
        <block xMin="216" yMin="114" xMax="326" yMax="124"><line><word>Divergent</word></line></block>
        <block xMin="273" yMin="137" xMax="307" yMax="145"><line><word>Thm.</word></line></block>
        <block xMin="204" yMin="156" xMax="338" yMax="168"><line><word>Gaussian</word></line></block>
        <block xMin="273" yMin="179" xMax="343" yMax="186"><line><word>Def.</word></line></block>
        <block xMin="201" yMin="199" xMax="341" yMax="212"><line><word>Sectorial</word></line></block>
        <block xMin="395" yMin="190" xMax="477" yMax="216"><line><word>One-loop</word></line></block>
        <block xMin="273" yMin="221" xMax="307" yMax="229"><line><word>Thm.</word></line></block>
        <block xMin="181" yMin="241" xMax="361" yMax="253"><line><word>Feldman</word></line></block>
        <block xMin="273" yMin="264" xMax="307" yMax="271"><line><word>Thm.</word></line></block>
        <block xMin="198" yMin="285" xMax="344" yMax="295"><line><word>Pro-torsor</word></line></block>
        <block xMin="186" yMin="305" xMax="224" yMax="313"><line><word>Thm.</word></line></block>
        <block xMin="318" yMin="305" xMax="352" yMax="313"><line><word>Thm.</word></line></block>
        <block xMin="126" yMin="327" xMax="218" yMax="337"><line><word>No-section</word></line></block>
        <block xMin="312" yMin="327" xMax="428" yMax="337"><line><word>External</word></line></block>
        <block xMin="178" yMin="369" xMax="364" yMax="379"><line><word>Finite-rank</word></line></block>
        <block xMin="70" yMin="400" xMax="526" yMax="483"><line><word>Figure</word></line></block>
      </page>
    `);

    const bbox = inferGraphicBboxAboveCaption(layout[0]!, {
      p: 1,
      x: 70,
      y: 400,
      w: 456,
      h: 83,
    });

    expect(bbox).toEqual({
      p: 1,
      x: expect.closeTo(84, 0),
      y: expect.closeTo(56, 0),
      w: expect.closeTo(434, 0),
      h: expect.closeTo(339, 0),
    });
  });
});
