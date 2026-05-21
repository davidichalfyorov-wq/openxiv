import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const jobStatusEnum = pgEnum('job_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'dead',
]);

export type JobStatus = (typeof jobStatusEnum.enumValues)[number];

export const jobsLog = pgTable(
  'jobs_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    queue: text('queue').notNull(),
    jobId: text('job_id').notNull(),
    status: jobStatusEnum('status').notNull(),
    attempts: integer('attempts').notNull().default(0),
    payload: jsonb('payload'),
    result: jsonb('result'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    queueIdx: index('jobs_log_queue_idx').on(t.queue),
    statusIdx: index('jobs_log_status_idx').on(t.status),
    jobIdx: index('jobs_log_job_idx').on(t.jobId),
  }),
);

export const compileArtifacts = pgTable(
  'compile_artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paperVersionId: uuid('paper_version_id').notNull(),
    success: text('success').notNull(),
    log: text('log'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    versionIdx: index('compile_artifacts_version_idx').on(t.paperVersionId),
  }),
);
