import { err, ok, Result, ResultAsync } from 'neverthrow';
import { Errors, type AppError } from './errors.js';

export { err, ok, Result, ResultAsync };
export type AppResult<T> = Result<T, AppError>;
export type AppResultAsync<T> = ResultAsync<T, AppError>;

/**
 * Wrap a promise into an AppResultAsync, mapping any rejection to an AppError
 * via the provided mapper. Defaults to AppError.internal.
 */
export function fromPromise<T>(
  promise: Promise<T>,
  mapErr: (err: unknown) => AppError = (cause) => Errors.internal('promise rejected', cause),
): AppResultAsync<T> {
  return ResultAsync.fromPromise(promise, mapErr);
}

/** Run a synchronous function, capturing thrown errors as AppError. */
export function fromThrowable<T>(
  fn: () => T,
  mapErr: (err: unknown) => AppError = (cause) => Errors.internal('threw', cause),
): AppResult<T> {
  try {
    return ok(fn());
  } catch (cause) {
    return err(mapErr(cause));
  }
}

/** Combine an array of AppResults into one, short-circuiting on first error. */
export function combine<T>(results: AppResult<T>[]): AppResult<T[]> {
  return Result.combine(results);
}
