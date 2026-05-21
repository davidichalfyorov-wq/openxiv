import CircuitBreaker from 'opossum';
import { AppError, Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';

export interface CircuitOptions {
  readonly name: string;
  readonly timeoutMs: number;
  /** Failure percent that trips the breaker (0..100). */
  readonly errorThresholdPercent?: number;
  /** Open duration before half-open (ms). */
  readonly resetTimeoutMs?: number;
  /** Rolling stats window used to calculate failure percentage. */
  readonly rollingWindowMs?: number;
  /** Minimum calls in the rolling window before failures can open the breaker. */
  readonly volumeThreshold?: number;
}

export const DEFAULT_CIRCUIT_ERROR_THRESHOLD_PERCENT = 50;
export const DEFAULT_CIRCUIT_ROLLING_WINDOW_MS = 5 * 60 * 1000;
export const DEFAULT_CIRCUIT_ROLLING_BUCKETS = 10;
export const DEFAULT_CIRCUIT_RESET_TIMEOUT_MS = 30_000;
export const DEFAULT_CIRCUIT_VOLUME_THRESHOLD = 5;

/**
 * Wrap a unary async function in an opossum circuit breaker that returns
 * AppResultAsync. Mapping rules:
 *  - call timeout / "Breaker is open" => external_unavailable
 *  - wrapped throw                    => external_invalid_response
 *  - resolve                          => Ok
 */
export function wrapBreaker<Input, Output>(
  options: CircuitOptions,
  fn: (input: Input) => Promise<Output>,
): (input: Input) => AppResultAsync<Output> {
  const breaker = new CircuitBreaker<[Input], Output>(async (input) => fn(input), {
    timeout: options.timeoutMs,
    errorThresholdPercentage: options.errorThresholdPercent ?? DEFAULT_CIRCUIT_ERROR_THRESHOLD_PERCENT,
    resetTimeout: options.resetTimeoutMs ?? DEFAULT_CIRCUIT_RESET_TIMEOUT_MS,
    rollingCountTimeout: options.rollingWindowMs ?? DEFAULT_CIRCUIT_ROLLING_WINDOW_MS,
    rollingCountBuckets: DEFAULT_CIRCUIT_ROLLING_BUCKETS,
    volumeThreshold: options.volumeThreshold ?? DEFAULT_CIRCUIT_VOLUME_THRESHOLD,
    name: options.name,
  });
  // Swallow unhandled rejection diagnostics; opossum already exposes events.
  breaker.on('open', () => {
    console.warn(`[circuit:${options.name}] open`);
  });
  breaker.on('halfOpen', () => {
    console.warn(`[circuit:${options.name}] half-open`);
  });
  breaker.on('close', () => {
    console.warn(`[circuit:${options.name}] close`);
  });

  return (input: Input) =>
    fromPromise(breaker.fire(input), (cause) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (message === 'Breaker is open' || message === 'Timed out after ' + options.timeoutMs + 'ms') {
        return Errors.externalUnavailable(`${options.name} unavailable`, cause);
      }
      if (cause instanceof AppError) return cause;
      return Errors.externalInvalidResponse(`${options.name} failed: ${message}`, message);
    });
}
