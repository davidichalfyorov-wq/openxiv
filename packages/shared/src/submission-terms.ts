/**
 * Canonical submission-terms text and the literal attestation string the
 * author must agree to. The web wizard, the /terms page, and the server-side
 * zod schema all import from here so there is exactly one source of truth.
 *
 * Bump SUBMISSION_TERMS_VERSION whenever the substance changes — old
 * acceptances stay recorded against the version they accepted at the time.
 */
export const SUBMISSION_TERMS_VERSION = 'v1';

export const SUBMISSION_TERMS_ATTESTATION = 'i-accept-openxiv-submission-terms-v1' as const;

export interface TermsSection {
  readonly heading: string;
  readonly body: readonly string[];
}

/**
 * Plain-English terms. Rendered as a modal at submit time and on /terms.
 * Each entry is a paragraph; the modal joins them with blank lines.
 *
 * Style: short sentences, no legalese-for-its-own-sake. Where we need a
 * legal-tone clause (no warranty, finality of refusal), keep it explicit
 * so it's hard to misread.
 */
export const SUBMISSION_TERMS_SECTIONS: readonly TermsSection[] = [
  {
    heading: 'Your responsibility for the content',
    body: [
      'You are the author. You are responsible for everything in the paper you upload — every claim, every figure, every reference, every author name in the byline.',
      'If something in your paper turns out to be wrong, misleading, fabricated, plagiarised, or someone else\'s work passed off as yours, that is on you, not on OpenXiv.',
      'By submitting you confirm that you either own the content or have a licence to publish it under the licence you chose.',
    ],
  },
  {
    heading: 'What we will not host',
    body: [
      'No offensive language, slurs, harassment, or content whose primary purpose is to insult or threaten a person or group.',
      'No falsified data, manipulated figures, or fabricated experiments. Honest mistakes are different — those get a correction or retraction notice, not a refusal.',
      'No content that violates law in our operating jurisdiction (CSAM, doxxing of private individuals, incitement to violence, sanctioned-jurisdiction material, malware, etc.).',
      'No plagiarism. If you used someone else\'s words, ideas, or figures, cite them. Don\'t pretend you didn\'t.',
    ],
  },
  {
    heading: 'On AI: disclose honestly',
    body: [
      'AI use is welcome on OpenXiv when you say so plainly. Pick one of four tiers at the disclosure step: none, assistant, co-author, primary. The disclosure is recorded on an app.openxiv.disclosure AT-proto record alongside the paper. Readers can filter on it; the Trust Passport surfaces it.',
      'Purely AI-generated papers are accepted as long as the content is actually scientific and the disclosure says "primary". We have no problem with the work being machine-made; we have a problem with it being machine-made in secret.',
      'Honesty is the line we will not cross. If you tick "none" or "assistant" when AI was in fact a co-author or primary author, that is dishonesty, not a minor mistake. You can be refused on that ground alone, even when the science would otherwise have been fine, and a future submission from you may be reviewed with more scepticism.',
    ],
  },
  {
    heading: 'AI slop: what it is and what happens to it',
    body: [
      'AI slop is what we call output that is shaped like science but is not. It is the failure mode where an LLM produces plausible-looking prose without anchoring it in real facts.',
      'Concrete things that count as AI slop on OpenXiv:',
      '— Hallucinated references: citations to papers that do not exist, real authors paired with papers they never wrote, made-up DOIs, made-up venue names, made-up author names entirely.',
      '— Fabricated math: equations that do not compute, "proofs" whose steps do not follow, dimensional inconsistencies a referee would spot in 30 seconds.',
      '— Made-up data: datasets, benchmarks, experiments, or institutional collaborations that never existed.',
      '— Boilerplate leakage: "As an AI language model…", "Sure! Here is a draft of…", "I cannot provide medical advice but…" left in the body.',
      '— Internal inconsistency: abstract says one thing, body says another; numbers in the table disagree with numbers in the text; figure captions describe a different figure.',
      '— Confident assertions in a field with no real engagement: namedrops of methods, datasets, or prior work that the paper never actually applies, computes against, or reasons about.',
      'A paper with a few hallucinated references inside otherwise real scientific work is sent back for revision. Fix the citations, resubmit, we move on. There is no year-long author ban for an unverified AI error; we name the failure mode, you fix it, the work is published.',
      'But outright slop, where a paper is mostly or entirely slop and there is no underlying scientific work to salvage, is rejected with a refusal packet that names the failure mode and points at the evidence. No revision loop on the rejected piece. We are not going to play whack-a-mole with regenerated drafts.',
      'If the work is not scientific in any recognisable sense (random LLM ramble, marketing copy, conspiracy material dressed as research, "manifesto" texts), the preprint is refused outright on the same grounds.',
    ],
  },
  {
    heading: 'How decisions are made',
    body: [
      'OpenXiv is a single-moderator, single-instance MVP. The owner decides what gets accepted, returned for revision, or refused.',
      'Returned-for-revision means you fix the problem and resubmit. The original is not published.',
      'In case of complete refusal, the decision is final. There is no appeal process and no second moderator review. We will say once, briefly, why it was refused; that is the end of it.',
      'Acceptance is not endorsement. We do not peer-review. Appearance on OpenXiv does not mean the work is correct.',
    ],
  },
  {
    heading: 'Retraction and tombstoning',
    body: [
      'Published papers can be retracted by you or by us. Either way, the OpenXiv id keeps resolving — it shows a tombstone with the retraction reason so citation graphs do not 404.',
      'We do not delete content for cosmetic reasons. We retract it and explain why.',
    ],
  },
  {
    heading: 'No warranty, limited liability',
    body: [
      'OpenXiv is provided as-is, without warranty of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement.',
      'To the maximum extent permitted by law, we are not liable for any direct, indirect, incidental, consequential, or punitive damages arising from your use of the service, your submission, or another user\'s submission.',
      'You agree to indemnify and hold the operator harmless against claims arising from content you submit — including copyright, defamation, and privacy claims.',
    ],
  },
  {
    heading: 'Changes to terms',
    body: [
      'We can update these terms. Existing acceptances remain recorded against the version that was current when you accepted them. New submissions are gated on the current version.',
    ],
  },
];

/**
 * Short blurb used as the checkbox label. Keep under ~80 chars so the
 * label fits on one line on mobile.
 */
export const SUBMISSION_TERMS_LABEL =
  'I have read and accept the OpenXiv submission terms.';
