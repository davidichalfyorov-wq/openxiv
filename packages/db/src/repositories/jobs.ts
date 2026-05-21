import { eq } from 'drizzle-orm';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { Database } from '../client.js';
import { jobsLog, type JobStatus } from '../schema/jobs.js';

export interface JobsRepository {
  record(input: {
    queue: string;
    jobId: string;
    status: JobStatus;
    attempts: number;
    payload?: unknown;
    result?: unknown;
    error?: string;
  }): AppResultAsync<void>;

  setStatus(jobId: string, status: JobStatus, opts?: { error?: string; result?: unknown }): AppResultAsync<void>;
}

export function makeJobsRepository(db: Database): JobsRepository {
  return {
    record(input) {
      return fromPromise(
        db
          .insert(jobsLog)
          .values({
            queue: input.queue,
            jobId: input.jobId,
            status: input.status,
            attempts: input.attempts,
            payload: input.payload ?? null,
            result: input.result ?? null,
            error: input.error ?? null,
          }),
        (cause) => Errors.internal('jobs.record', cause),
      ).map(() => undefined);
    },
    setStatus(jobId, status, opts = {}) {
      return fromPromise(
        db
          .update(jobsLog)
          .set({
            status,
            updatedAt: new Date(),
            ...(opts.error !== undefined ? { error: opts.error } : {}),
            ...(opts.result !== undefined ? { result: opts.result } : {}),
          })
          .where(eq(jobsLog.jobId, jobId)),
        (cause) => Errors.internal('jobs.setStatus', cause),
      ).map(() => undefined);
    },
  };
}
