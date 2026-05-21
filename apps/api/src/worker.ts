import 'dotenv/config';
import { parseEnv } from '@openxiv/shared';
import { buildContext } from './context.js';
import { captureError, flushErrorTracking, initErrorTracking } from './services/error-tracking.js';
import { startWorkers } from './workers/index.js';

const SHUTDOWN_DEADLINE_MS = 30_000;

async function main(): Promise<void> {
  const env = parseEnv(process.env);
  initErrorTracking(env);
  const ctx = await buildContext(env);
  const workers = startWorkers(ctx);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      console.warn(`[workers] shutdown in progress (${signal}) — ignoring`);
      return;
    }
    shuttingDown = true;
    console.warn(`[workers] received ${signal}, draining for up to ${SHUTDOWN_DEADLINE_MS}ms`);

    const deadline = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), SHUTDOWN_DEADLINE_MS).unref(),
    );
    const work = (async (): Promise<'ok'> => {
      try {
        await workers.close();
      } finally {
        await flushErrorTracking();
        await ctx.shutdown();
      }
      return 'ok';
    })();

    const result = await Promise.race([work, deadline]);
    if (result === 'timeout') {
      console.error(`[workers] graceful drain hit ${SHUTDOWN_DEADLINE_MS}ms — force exit`);
      process.exit(1);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    captureError(reason);
    console.error('[workers] unhandledRejection', reason);
  });
  process.on('uncaughtException', (err) => {
    captureError(err);
    console.error('[workers] uncaughtException', err);
    void shutdown('uncaughtException').finally(() => process.exit(1));
  });

  console.warn('[workers] started — listening on BullMQ queues');
}

void main();
