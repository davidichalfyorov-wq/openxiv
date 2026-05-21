import { describe, expect, it } from 'vitest';
import {
  ENDORSEMENT_VERBS,
  ENDORSEMENT_LEX_ID,
  endorsementRecordSchema,
  endorsementVerbSchema,
} from './endorsement.js';

describe('app.openxiv.endorsement lexicon', () => {
  const isoNow = '2026-05-17T12:00:00Z';
  const paperUri = 'at://did:plc:abcdefghijklmnopqrstuvwx/app.openxiv.paper/3kqxabc123def';

  it('accepts every documented verb', () => {
    for (const verb of ENDORSEMENT_VERBS) {
      const parsed = endorsementRecordSchema.safeParse({
        paperUri,
        verb,
        createdAt: isoNow,
      });
      expect(parsed.success).toBe(true);
    }
  });

  it('rejects an unknown verb', () => {
    const parsed = endorsementRecordSchema.safeParse({
      paperUri,
      verb: 'thumbs_up',
      createdAt: isoNow,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects missing verb — verb is required from #12 onward', () => {
    const parsed = endorsementRecordSchema.safeParse({
      paperUri,
      createdAt: isoNow,
    });
    expect(parsed.success).toBe(false);
  });

  it('strips $type when present (lexicon round-trip)', () => {
    const parsed = endorsementRecordSchema.parse({
      $type: ENDORSEMENT_LEX_ID,
      paperUri,
      verb: 'reproduced_result',
      createdAt: isoNow,
    });
    expect(parsed.verb).toBe('reproduced_result');
  });

  it('enforces note length cap', () => {
    const long = 'x'.repeat(501);
    const parsed = endorsementRecordSchema.safeParse({
      paperUri,
      verb: 'useful_background',
      note: long,
      createdAt: isoNow,
    });
    expect(parsed.success).toBe(false);
  });

  it('verbs are unique (no accidental duplicates from refactors)', () => {
    const set = new Set(ENDORSEMENT_VERBS);
    expect(set.size).toBe(ENDORSEMENT_VERBS.length);
  });

  it('verbSchema enum matches the exported tuple', () => {
    for (const v of ENDORSEMENT_VERBS) {
      expect(endorsementVerbSchema.safeParse(v).success).toBe(true);
    }
  });
});
