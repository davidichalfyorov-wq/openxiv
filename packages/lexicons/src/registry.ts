import type { z } from 'zod';
import { CITATION_LEX_ID, citationRecordSchema, type CitationRecord } from './citation.js';
import {
  DISCLOSURE_LEX_ID,
  disclosureRecordSchema,
  type DisclosureRecord,
} from './disclosure.js';
import {
  ENDORSEMENT_LEX_ID,
  endorsementRecordSchema,
  type EndorsementRecord,
} from './endorsement.js';
import {
  PAPER_LEX_ID,
  PREPRINT_LEX_ID,
  paperRecordSchema,
  preprintRecordSchema,
  type PaperRecord,
  type PreprintRecord,
} from './paper.js';
import { POST_LEX_ID, postRecordSchema, type PostRecord } from './post.js';
import { PREREG_LEX_ID, preregRecordSchema, type PreregRecord } from './prereg.js';
import { REVIEW_LEX_ID, reviewRecordSchema, type ReviewRecord } from './review.js';
import { SUMMARY_LEX_ID, summaryRecordSchema, type SummaryRecord } from './summary.js';

export type LexId =
  | typeof PAPER_LEX_ID
  | typeof PREPRINT_LEX_ID
  | typeof SUMMARY_LEX_ID
  | typeof DISCLOSURE_LEX_ID
  | typeof POST_LEX_ID
  | typeof REVIEW_LEX_ID
  | typeof ENDORSEMENT_LEX_ID
  | typeof CITATION_LEX_ID
  | typeof PREREG_LEX_ID;

export type RecordByLexId = {
  [PAPER_LEX_ID]: PaperRecord;
  [PREPRINT_LEX_ID]: PreprintRecord;
  [SUMMARY_LEX_ID]: SummaryRecord;
  [DISCLOSURE_LEX_ID]: DisclosureRecord;
  [POST_LEX_ID]: PostRecord;
  [REVIEW_LEX_ID]: ReviewRecord;
  [ENDORSEMENT_LEX_ID]: EndorsementRecord;
  [CITATION_LEX_ID]: CitationRecord;
  [PREREG_LEX_ID]: PreregRecord;
};

export const recordSchemas: Record<LexId, z.ZodTypeAny> = {
  [PAPER_LEX_ID]: paperRecordSchema,
  [PREPRINT_LEX_ID]: preprintRecordSchema,
  [SUMMARY_LEX_ID]: summaryRecordSchema,
  [DISCLOSURE_LEX_ID]: disclosureRecordSchema,
  [POST_LEX_ID]: postRecordSchema,
  [REVIEW_LEX_ID]: reviewRecordSchema,
  [ENDORSEMENT_LEX_ID]: endorsementRecordSchema,
  [CITATION_LEX_ID]: citationRecordSchema,
  [PREREG_LEX_ID]: preregRecordSchema,
};

export const LEX_IDS: readonly LexId[] = [
  PAPER_LEX_ID,
  PREPRINT_LEX_ID,
  SUMMARY_LEX_ID,
  DISCLOSURE_LEX_ID,
  POST_LEX_ID,
  REVIEW_LEX_ID,
  ENDORSEMENT_LEX_ID,
  CITATION_LEX_ID,
  PREREG_LEX_ID,
];

export function validateRecord<L extends LexId>(
  lexId: L,
  data: unknown,
): RecordByLexId[L] {
  const schema = recordSchemas[lexId];
  return schema.parse(data) as RecordByLexId[L];
}

export function safeValidateRecord<L extends LexId>(
  lexId: L,
  data: unknown,
): { success: true; data: RecordByLexId[L] } | { success: false; error: z.ZodError } {
  const result = recordSchemas[lexId].safeParse(data);
  if (result.success) {
    return { success: true, data: result.data as RecordByLexId[L] };
  }
  return { success: false, error: result.error };
}
