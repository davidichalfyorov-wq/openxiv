import type { FastifyRequest } from 'fastify';
import * as Sentry from '@sentry/node';
import type { AppEnv } from '@openxiv/shared';

type HeaderBag = Record<string, string | string[] | undefined>;

let initialized = false;

export function initErrorTracking(env: Pick<
  AppEnv,
  'NODE_ENV' | 'SENTRY_DSN' | 'SENTRY_RELEASE' | 'SENTRY_TRACES_SAMPLE_RATE'
>): boolean {
  if (!env.SENTRY_DSN) return false;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: env.SENTRY_RELEASE || undefined,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers['cookie'];
        delete event.request.headers['authorization'];
        delete event.request.headers['x-forwarded-for'];
      }
      delete event.request?.cookies;
      return event;
    },
  });
  initialized = true;
  return true;
}

export function shouldSkipErrorTracking(headers: HeaderBag): boolean {
  return (
    headerEquals(headers, 'dnt', '1') ||
    headerEquals(headers, 'do-not-track', '1') ||
    headerEquals(headers, 'sec-gpc', '1') ||
    /(?:^|;\s*)openxiv_notrack=1(?:;|$)/.test(headerValue(headers, 'cookie') ?? '')
  );
}

export function captureError(err: unknown, request?: FastifyRequest): void {
  if (!initialized) return;
  if (request && shouldSkipErrorTracking(request.headers as HeaderBag)) return;

  Sentry.withScope((scope) => {
    if (request) {
      scope.setTag('request_id', request.id);
      scope.setTag('method', request.method);
      scope.setTag('path', request.url.split('?', 1)[0] ?? request.url);
      if (request.session?.did) scope.setTag('user_did', request.session.did);
    }
    Sentry.captureException(err);
  });
}

export async function flushErrorTracking(timeoutMs = 2_000): Promise<boolean> {
  if (!initialized) return true;
  return Sentry.flush(timeoutMs);
}

function headerEquals(headers: HeaderBag, name: string, expected: string): boolean {
  return headerValue(headers, name) === expected;
}

function headerValue(headers: HeaderBag, name: string): string | undefined {
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(direct)) return direct[0];
  return direct;
}
