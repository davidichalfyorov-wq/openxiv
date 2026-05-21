/**
 * Side-by-side comparison data for OpenXiv vs the major preprint servers.
 *
 * Each row is a single dimension (endorsement gate, AI policy, federation,
 * post-publication review, refusal model, ISSN, DOI, default license,
 * source mandate, eligibility). The cells are short, factual, and citable
 * so an answer engine quoting a single row gets a self-contained claim.
 *
 * The OpenXiv column is derived from the running site (terms, code of
 * conduct, ISSN registration). The competitor columns are summaries of
 * each server's published policy as of 2026-05; if any field looks stale,
 * the source URL on the competitor's policy page is the authoritative
 * version.
 */
import { OPENXIV_ISSN } from '@openxiv/shared';

export interface CompareRow {
  dimension: string;
  openxiv: string;
  competitor: string;
}

export interface CompetitorProfile {
  slug: 'arxiv' | 'biorxiv' | 'ssrn' | 'researchsquare' | 'chemrxiv';
  name: string;
  url: string;
  fields: string;
  blurb: string;
  rows: CompareRow[];
}

const issnCell = `Yes, ISSN ${OPENXIV_ISSN}, registered 2026-05-18`;

const arxiv: CompetitorProfile = {
  slug: 'arxiv',
  name: 'arXiv',
  url: 'https://arxiv.org',
  fields: 'Physics, mathematics, computer science, quantitative biology, statistics, EE, economics',
  blurb:
    'arXiv is the original preprint server, founded in 1991 and operated by Cornell University. It is the trusted standard for several STEM fields. OpenXiv is intentionally complementary on the social and open-eligibility axes; cross-posting to arXiv is encouraged where it is the field standard.',
  rows: [
    {
      dimension: 'Endorsement gate',
      openxiv: 'None. Anyone can submit.',
      competitor: 'Required in some categories. A first-time author must be endorsed by an existing arXiv author in the same subfield.',
    },
    {
      dimension: 'AI policy',
      openxiv:
        'AI use is disclosed at one of four levels (none, assistant, coauthor, primary). Unverified or hallucinated output is refused per paper with a public refusal packet; the author can revise and resubmit. No author bans.',
      competitor:
        'Authors using generative AI are required to declare it. Unverified AI-generated content has been treated as grounds for a multi-month author ban under the 2026-05 policy update.',
    },
    {
      dimension: 'Federation',
      openxiv:
        'AT Protocol. Every accepted preprint is an AT-proto record under app.openxiv.* and a bridge post on Bluesky.',
      competitor:
        'None. arXiv is a centralized repository with RSS, OAI-PMH, and Atom feeds, but does not federate to a social protocol.',
    },
    {
      dimension: 'Post-publication review',
      openxiv:
        'Typed endorsements (verified derivation, reproduced result, checked references, useful background, important but flawed, needs correction) attached to each paper. Public Trust Passport.',
      competitor:
        'No native post-publication review surface. Comments and discussion happen on external platforms.',
    },
    {
      dimension: 'Refusal model',
      openxiv:
        'Public refusal packet that names the failure mode and points at the evidence. Authors may revise and resubmit.',
      competitor:
        'Submission may be rejected or withdrawn from listing. Reasons are communicated privately to the author; sanctions can include multi-month author bans.',
    },
    { dimension: 'ISSN', openxiv: issnCell, competitor: 'No site-wide ISSN.' },
    {
      dimension: 'DOI',
      openxiv: 'On the preservation roadmap via Crossref. OpenXiv identifier is the persistent identifier today.',
      competitor: 'arXiv ID is the persistent identifier. DOIs are assigned via DataCite as of 2022.',
    },
    {
      dimension: 'Default license',
      openxiv: 'CC-BY-4.0 (CC-BY-SA, CC0, and permissive software licenses also accepted).',
      competitor:
        'Authors choose between arXiv non-exclusive license, CC-BY, CC-BY-SA, CC-BY-NC-SA, CC0, or "arXiv perpetual non-exclusive license".',
    },
    {
      dimension: 'Source mandate',
      openxiv:
        'Source archive required (LaTeX tarball preferred). PDF-only uploads are blocked.',
      competitor: 'TeX source preferred and strongly encouraged; PDF-only uploads are accepted but discouraged.',
    },
    {
      dimension: 'Eligibility',
      openxiv:
        'Independent researchers welcome. No institutional affiliation required.',
      competitor:
        'Open to researchers worldwide; some categories require endorsement which functions as an institutional-network filter for first-time authors.',
    },
  ],
};

const biorxiv: CompetitorProfile = {
  slug: 'biorxiv',
  name: 'bioRxiv',
  url: 'https://www.biorxiv.org',
  fields: 'Biology (companion medRxiv covers clinical medicine)',
  blurb:
    'bioRxiv is the preprint server for the biological sciences, operated by Cold Spring Harbor Laboratory. It runs a basic screening process and is the dominant preprint venue for life sciences.',
  rows: [
    {
      dimension: 'Endorsement gate',
      openxiv: 'None.',
      competitor:
        'No endorser, but bioRxiv runs a basic screening for plagiarism, dual-use bio research, and policy fit before posting.',
    },
    {
      dimension: 'AI policy',
      openxiv: 'Four-level AI disclosure. Per-paper refusal with named failure mode. No author bans.',
      competitor:
        'AI use must be declared in the manuscript. Editorial discretion to remove papers that fail screening.',
    },
    {
      dimension: 'Federation',
      openxiv: 'AT Protocol with Bluesky bridge posts.',
      competitor: 'None. RSS and Twitter announcement feeds only.',
    },
    {
      dimension: 'Post-publication review',
      openxiv: 'Typed endorsements and Trust Passport.',
      competitor:
        'On-paper public comment thread (free text). No typed review vocabulary.',
    },
    {
      dimension: 'Refusal model',
      openxiv: 'Public refusal packet, revise-and-resubmit.',
      competitor: 'Manuscripts that fail screening are withdrawn privately. Limited public reasoning.',
    },
    { dimension: 'ISSN', openxiv: issnCell, competitor: 'No site-wide ISSN.' },
    {
      dimension: 'DOI',
      openxiv: 'Roadmap (Crossref).',
      competitor: 'DOIs minted at posting (Crossref).',
    },
    {
      dimension: 'Default license',
      openxiv: 'CC-BY-4.0.',
      competitor: 'CC-BY-NC-ND default; CC-BY, CC-BY-NC, CC0 also available.',
    },
    {
      dimension: 'Source mandate',
      openxiv: 'Source archive required.',
      competitor: 'PDF accepted (DOCX accepted as well). No source mandate.',
    },
    {
      dimension: 'Eligibility',
      openxiv: 'Independent researchers welcome on equal footing.',
      competitor: 'Authors must affirm at submission that they are bona fide researchers in a relevant field.',
    },
  ],
};

const ssrn: CompetitorProfile = {
  slug: 'ssrn',
  name: 'SSRN',
  url: 'https://www.ssrn.com',
  fields: 'Social sciences, economics, finance, law, humanities (also some life sciences via expansion)',
  blurb:
    'SSRN (Social Science Research Network) is operated by Elsevier and hosts working papers across the social sciences and beyond. It has the largest catalog by volume in its core fields.',
  rows: [
    {
      dimension: 'Endorsement gate',
      openxiv: 'None.',
      competitor: 'None for authors with verified affiliation; otherwise editorial review.',
    },
    {
      dimension: 'AI policy',
      openxiv: 'Four-level disclosure, per-paper refusal.',
      competitor: 'Authors required to disclose generative-AI use; SSRN may withdraw papers at editorial discretion.',
    },
    {
      dimension: 'Federation',
      openxiv: 'AT Protocol with Bluesky bridges.',
      competitor: 'None. Email alerts and ranked download feeds.',
    },
    {
      dimension: 'Post-publication review',
      openxiv: 'Typed endorsements.',
      competitor: 'Download counts and "All Time Downloads" rank are the only public signal.',
    },
    {
      dimension: 'Refusal model',
      openxiv: 'Public refusal packet.',
      competitor: 'Private editorial communication; recent withdrawals have been controversial when papers were removed without public reason.',
    },
    { dimension: 'ISSN', openxiv: issnCell, competitor: 'No site-wide ISSN; some SSRN networks register their own.' },
    {
      dimension: 'DOI',
      openxiv: 'Roadmap.',
      competitor: 'DOIs minted on posting (Crossref).',
    },
    {
      dimension: 'Default license',
      openxiv: 'CC-BY-4.0.',
      competitor: 'Author retains copyright; SSRN takes a non-exclusive distribution license. Open-license selection is optional.',
    },
    {
      dimension: 'Source mandate',
      openxiv: 'Source archive required.',
      competitor: 'PDF accepted. No source mandate.',
    },
    {
      dimension: 'Eligibility',
      openxiv: 'Independent researchers welcome.',
      competitor: 'Open to all but emphasizes affiliated academic authors; non-affiliated authors are subject to more scrutiny.',
    },
  ],
};

const researchsquare: CompetitorProfile = {
  slug: 'researchsquare',
  name: 'Research Square',
  url: 'https://www.researchsquare.com',
  fields: 'All disciplines, with a heavy biomedical and clinical concentration',
  blurb:
    'Research Square is a commercial preprint platform run by the parent of Springer Nature, often used as the preprint deposit step in the In Review service attached to Springer Nature journals.',
  rows: [
    {
      dimension: 'Endorsement gate',
      openxiv: 'None.',
      competitor: 'None, but identity verification and screening are required.',
    },
    {
      dimension: 'AI policy',
      openxiv: 'Four-level disclosure, per-paper refusal.',
      competitor: 'Generative AI use must be declared; AI cannot be listed as an author.',
    },
    {
      dimension: 'Federation',
      openxiv: 'AT Protocol.',
      competitor: 'None.',
    },
    {
      dimension: 'Post-publication review',
      openxiv: 'Typed endorsements.',
      competitor:
        'In Review surfaces peer review status from the linked Springer Nature journal. No independent typed-review vocabulary.',
    },
    {
      dimension: 'Refusal model',
      openxiv: 'Public refusal packet.',
      competitor: 'Editorial withdrawal at platform discretion.',
    },
    { dimension: 'ISSN', openxiv: issnCell, competitor: 'No site-wide ISSN.' },
    {
      dimension: 'DOI',
      openxiv: 'Roadmap.',
      competitor: 'DOIs minted on posting (Crossref).',
    },
    {
      dimension: 'Default license',
      openxiv: 'CC-BY-4.0.',
      competitor: 'CC-BY-4.0 default; CC-BY-SA, CC-BY-NC, CC-BY-ND, CC0 also available.',
    },
    {
      dimension: 'Source mandate',
      openxiv: 'Source archive required.',
      competitor: 'PDF or DOCX accepted. No source mandate.',
    },
    {
      dimension: 'Eligibility',
      openxiv: 'Independent researchers welcome.',
      competitor: 'Open to all researchers; commercial-platform onboarding includes an identity check.',
    },
  ],
};

const chemrxiv: CompetitorProfile = {
  slug: 'chemrxiv',
  name: 'ChemRxiv',
  url: 'https://chemrxiv.org',
  fields: 'Chemistry and chemistry-adjacent (materials, chemical biology)',
  blurb:
    'ChemRxiv is the chemistry preprint server, co-owned by the American Chemical Society, Royal Society of Chemistry, German Chemical Society, Chinese Chemical Society, and Chemical Society of Japan.',
  rows: [
    {
      dimension: 'Endorsement gate',
      openxiv: 'None.',
      competitor: 'None, but submissions go through a moderation queue with subject-matter review.',
    },
    {
      dimension: 'AI policy',
      openxiv: 'Four-level disclosure, per-paper refusal.',
      competitor: 'AI use must be declared; AI cannot be listed as an author.',
    },
    {
      dimension: 'Federation',
      openxiv: 'AT Protocol.',
      competitor: 'None.',
    },
    {
      dimension: 'Post-publication review',
      openxiv: 'Typed endorsements.',
      competitor: 'On-paper comments. No typed-review vocabulary.',
    },
    {
      dimension: 'Refusal model',
      openxiv: 'Public refusal packet.',
      competitor: 'Editorial rejection during the moderation queue; the platform does not surface refusals publicly.',
    },
    { dimension: 'ISSN', openxiv: issnCell, competitor: 'No site-wide ISSN.' },
    {
      dimension: 'DOI',
      openxiv: 'Roadmap.',
      competitor: 'DOIs minted on posting (Crossref).',
    },
    {
      dimension: 'Default license',
      openxiv: 'CC-BY-4.0.',
      competitor: 'CC-BY-NC-ND default; CC-BY, CC-BY-NC, CC0, ACS AuthorChoice also available.',
    },
    {
      dimension: 'Source mandate',
      openxiv: 'Source archive required.',
      competitor: 'PDF accepted; data and structure files encouraged but not mandated.',
    },
    {
      dimension: 'Eligibility',
      openxiv: 'Independent researchers welcome.',
      competitor: 'Submissions are screened for subject relevance; affiliation is requested but not required.',
    },
  ],
};

export const COMPETITORS: Record<string, CompetitorProfile> = {
  arxiv,
  biorxiv,
  ssrn,
  researchsquare,
  chemrxiv,
};

export const COMPETITOR_SLUGS = Object.keys(COMPETITORS) as Array<keyof typeof COMPETITORS>;
