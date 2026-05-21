export interface FetchWithRetryInit extends RequestInit {
  readonly timeoutMs?: number;
  readonly attempts?: number;
  readonly backoffMs?: number;
  readonly retryStatuses?: readonly number[];
}

export const DEFAULT_HTTP_TIMEOUT_MS = 10_000;
export const DEFAULT_HTTP_ATTEMPTS = 3;
export const DEFAULT_HTTP_BACKOFF_MS = 250;
export const DEFAULT_HTTP_RETRY_STATUSES = [408, 409, 425, 429, 500, 502, 503, 504] as const;

export async function fetchWithTimeoutRetry(
  input: string | URL | Request,
  init: FetchWithRetryInit = {},
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
    attempts = DEFAULT_HTTP_ATTEMPTS,
    backoffMs = DEFAULT_HTTP_BACKOFF_MS,
    retryStatuses,
    signal: callerSignal,
    ...fetchInit
  } = init;
  const retryable = retryStatuses
    ? new Set(retryStatuses)
    : new Set(DEFAULT_HTTP_RETRY_STATUSES);
  const maxAttempts = Math.max(1, attempts);

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = combineSignals(callerSignal, controller.signal);
    try {
      const response = await fetch(input, { ...fetchInit, signal });
      clearTimeout(timer);
      if (!retryable.has(response.status) || attempt === maxAttempts) return response;
      await response.body?.cancel().catch(() => {});
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt === maxAttempts || callerSignal?.aborted) throw err;
    }
    await sleep(backoffMs * 2 ** (attempt - 1));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function combineSignals(
  callerSignal: AbortSignal | null | undefined,
  timeoutSignal: AbortSignal,
): AbortSignal {
  if (!callerSignal) return timeoutSignal;
  if (callerSignal.aborted) return callerSignal;
  return AbortSignal.any([callerSignal, timeoutSignal]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
