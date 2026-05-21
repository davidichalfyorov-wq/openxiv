/**
 * Mapping from OpenXiv / arXiv category codes to Wikidata Q identifiers.
 *
 * Used by /topics/[slug] to attach a schema.org `about: { @type: Thing,
 * sameAs: [<wikidata-url>] }` block to the ItemList JSON-LD. Entity
 * reconciliation: an answer engine seeing the topic page can now resolve
 * "cs.AI" to the same Wikidata node as the Wikipedia page on artificial
 * intelligence and rank the topic dossier alongside encyclopedic results.
 *
 * Coverage: the 30 most-used arXiv-shaped codes across OpenXiv, picked
 * to give every CATEGORY_GROUP at least one anchor. Codes outside this
 * list silently fall through to the no-`about` branch in the topic page.
 *
 * Each Q id can be verified at https://www.wikidata.org/wiki/{Q}.
 */

export const CATEGORY_WIKIDATA: Readonly<Record<string, string>> = {
  // Computer Science
  'cs.AI': 'Q11660',
  'cs.LG': 'Q2539',
  'cs.CL': 'Q30642',
  'cs.CV': 'Q844240',
  'cs.CR': 'Q3510521',
  'cs.DC': 'Q335877',
  'cs.DS': 'Q23807',
  'cs.SE': 'Q638608',
  'cs.HC': 'Q207434',

  // Mathematics
  'math.AG': 'Q186611',
  'math.AP': 'Q2152509',
  'math.CO': 'Q76592',
  'math.NT': 'Q11214',
  'math.PR': 'Q177912',
  'math.LO': 'Q47038',

  // Physics
  'physics.gen-ph': 'Q1062948',
  'hep-th': 'Q193626',
  'gr-qc': 'Q11455',
  'quant-ph': 'Q944',
  'cond-mat.supr-con': 'Q11651',
  'astro-ph.CO': 'Q4407',

  // Statistics
  'stat.ML': 'Q2539',
  'stat.ME': 'Q1322005',

  // Quantitative Biology
  'q-bio.NC': 'Q207011',
  'q-bio.GN': 'Q305296',

  // EE / Systems
  'eess.SP': 'Q386275',
  'eess.IV': 'Q860623',

  // Quantitative Finance
  'q-fin.MF': 'Q1156614',

  // Economics
  'econ.EM': 'Q179179',

  // Earth & Space
  'earth.atm': 'Q39816',
};

const WIKIDATA_BASE = 'https://www.wikidata.org/wiki/';

/**
 * Resolve a category code to a Wikidata URL, or `null` if no mapping
 * exists. The topic page emits `about.sameAs` only when this is set.
 */
export function wikidataUrlForCategory(code: string): string | null {
  const q = CATEGORY_WIKIDATA[code];
  return q ? `${WIKIDATA_BASE}${q}` : null;
}
