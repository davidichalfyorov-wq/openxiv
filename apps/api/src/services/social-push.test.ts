import { describe, expect, it } from 'vitest';
import { buildMastodonStatus, normalizeInstanceUrl } from './mastodon-crosspost.js';
import { QUEUE_NAMES } from '../context.js';
import {
  MASTODON_CROSSPOST_RATE_LIMIT,
  rethrowForBullMQ,
  shouldRecordDeadLetter,
  socialWorkerLimiter,
} from '../workers/index.js';
import { Errors } from '@openxiv/shared';
import type { PaperRecord } from '@openxiv/db';
import { UnrecoverableError } from 'bullmq';

const paper = {
  id: '11111111-1111-4111-8111-111111111111',
  openxivId: 'openxiv:physics.gen-ph.2026.00001',
  uri: null,
  cid: null,
  submitterDid: 'did:web:openxiv.net:u:orcid.0000',
  title: 'Crosspost & ORCID XML',
  abstract: null,
  license: 'CC-BY-4.0',
  primaryCategory: 'physics.gen-ph',
  crossListings: [],
  doi: '10.1234/openxiv.test',
  status: 'published',
  versionNote: null,
  supersedesUri: null,
  submissionTermsVersion: null,
  submissionTermsAcceptedAt: null,
  oneHardQuestion: null,
  launchKit: null,
  createdAt: new Date('2026-05-01T12:00:00Z'),
  updatedAt: new Date('2026-05-01T12:00:00Z'),
  publishedAt: new Date('2026-05-02T12:00:00Z'),
} satisfies PaperRecord;

describe('Mastodon status', () => {
  it('normalizes arbitrary instance input', () => {
    expect(normalizeInstanceUrl('mastodon.social/@x')).toBe('https://mastodon.social');
  });

  it('builds a bounded public status with OpenXiv URL and category tag', () => {
    const status = buildMastodonStatus(paper, 'https://openxiv.net');
    expect(status).toContain('https://openxiv.net/p/physics.gen-ph.2026.00001');
    expect(status).toContain('#preprint');
    expect(status).toContain('#physicsGenPh');
    expect(status.length).toBeLessThanOrEqual(500);
  });

  it('documents the queue-level instance rate limit', () => {
    expect(MASTODON_CROSSPOST_RATE_LIMIT).toEqual({
      max: 300,
      duration: 5 * 60 * 1000,
    });
    expect(socialWorkerLimiter(QUEUE_NAMES.mastodonCrosspost)).toEqual(
      MASTODON_CROSSPOST_RATE_LIMIT,
    );
  });
});

describe('social push DLQ selection', () => {
  it('treats Mastodon rate limits as retriable worker failures', () => {
    let thrown: unknown;
    try {
      rethrowForBullMQ(
        Errors.externalInvalidResponse(
          'mastodon.status.post',
          new Error('Mastodon status 429: rate limit exceeded'),
        ),
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(UnrecoverableError);
  });

  it('records every critical queue final failure', () => {
    expect(
      shouldRecordDeadLetter({
        queueName: QUEUE_NAMES.mastodonCrosspost,
        attemptsMade: 2,
        attempts: 5,
      }),
    ).toBe(false);
    expect(
      shouldRecordDeadLetter({
        queueName: QUEUE_NAMES.mastodonCrosspost,
        attemptsMade: 1,
        attempts: 5,
        unrecoverable: true,
      }),
    ).toBe(true);
    expect(
      shouldRecordDeadLetter({
        queueName: QUEUE_NAMES.compile,
        attemptsMade: 5,
        attempts: 5,
      }),
    ).toBe(true);
    expect(
      shouldRecordDeadLetter({
        queueName: QUEUE_NAMES.bskyFollow,
        attemptsMade: 5,
        attempts: 5,
      }),
    ).toBe(true);
    expect(
      shouldRecordDeadLetter({
        queueName: QUEUE_NAMES.pdfFinalize,
        attemptsMade: 5,
        attempts: 5,
      }),
    ).toBe(true);
    expect(
      shouldRecordDeadLetter({
        queueName: QUEUE_NAMES.compile,
        attemptsMade: 4,
        attempts: 5,
      }),
    ).toBe(false);
  });
});
