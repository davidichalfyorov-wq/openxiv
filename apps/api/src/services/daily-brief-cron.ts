import type { AppContext } from '../context.js';
import { composeDailyBrief } from './daily-brief.js';
import type { FlagsService } from './flags.js';
import { FLAGS } from './flags.js';

/**
 * In-process cron for the Daily Brief snapshot.
 *
 * Fires every hour. If we are inside the 00:00-01:00 UTC window AND there is
 * no snapshot yet for today, compose + upsert one. Idempotent on the date
 * primary key — a process restart inside the window safely re-runs without
 * duplicating.
 *
 * Why setInterval and not BullMQ: this is a single tiny job, daily. Adding
 * a worker process for it costs more than it saves; the api already runs
 * 24/7 and the snapshot completes in <500ms.
 */
export interface DailyBriefCron {
  start(): void;
  stop(): void;
}

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1h

export function makeDailyBriefCron(ctx: AppContext, flags: FlagsService): DailyBriefCron {
  let timer: NodeJS.Timeout | null = null;

  async function tick(): Promise<void> {
    try {
      const enabled = await flags.isEnabled(FLAGS.DAILY_BRIEF, true);
      if (!enabled) return;
      const now = new Date();
      const hourUtc = now.getUTCHours();
      // Run only inside 00:00-01:00 UTC. Outside the window we wait.
      if (hourUtc !== 0) return;
      const todayIso = now.toISOString().slice(0, 10);
      const existing = await ctx.repos.dailyBriefs.get(todayIso);
      if (existing.isOk() && existing.value) return;
      const brief = await composeDailyBrief(ctx);
      const upsert = await ctx.repos.dailyBriefs.upsert(brief.date, brief.items);
      if (upsert.isErr()) {
        // Surface to logs via the standard pino in caller scope.
        console.error('[daily-brief-cron] upsert failed:', upsert.error.message);
      }
    } catch (e) {
      // Cron must never crash the process.
      console.error('[daily-brief-cron] tick threw:', (e as Error).message);
    }
  }

  return {
    start() {
      if (timer) return;
      // Fire once immediately so the snapshot still happens if the process
      // restarted inside the window, then settle into the hourly tick.
      void tick();
      timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
      if (typeof timer.unref === 'function') timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
