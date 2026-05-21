import 'dotenv/config';
import { parseEnv } from '@openxiv/shared';
import { buildContext } from './context.js';
import { buildServer } from './server.js';
import { captureError, flushErrorTracking, initErrorTracking } from './services/error-tracking.js';

const SHUTDOWN_DEADLINE_MS = 25_000;

async function main(): Promise<void> {
  const env = parseEnv(process.env);
  initErrorTracking(env);
  const ctx = await buildContext(env);
  const app = await buildServer(ctx);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      app.log.warn({ signal }, 'shutdown already in progress — ignoring repeat signal');
      return;
    }
    shuttingDown = true;
    app.log.warn({ signal, deadlineMs: SHUTDOWN_DEADLINE_MS }, 'shutting down');

    const deadline = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), SHUTDOWN_DEADLINE_MS).unref(),
    );
    const work = (async (): Promise<'ok'> => {
      try {
        await app.close();
      } finally {
        await flushErrorTracking();
        await ctx.shutdown();
      }
      return 'ok';
    })();

    const result = await Promise.race([work, deadline]);
    if (result === 'timeout') {
      app.log.error({ signal }, 'graceful shutdown timed out — force-exiting');
      process.exit(1);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    captureError(reason);
    app.log.error({ reason }, 'unhandledRejection — refusing silent failure');
  });
  process.on('uncaughtException', (err) => {
    captureError(err);
    app.log.fatal({ err }, 'uncaughtException — exiting');
    void shutdown('uncaughtException').finally(() => process.exit(1));
  });

  try {
    await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
    app.log.info({ port: env.API_PORT }, 'api listening');
  } catch (err) {
    app.log.error({ err }, 'failed to start');
    process.exit(1);
  }
}

void main();
