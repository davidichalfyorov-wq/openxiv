export type AppErrorKind =
  | 'validation'
  | 'not_found'
  | 'unauthorized'
  | 'forbidden'
  | 'conflict'
  | 'rate_limited'
  | 'external_unavailable'
  | 'external_timeout'
  | 'external_invalid_response'
  | 'storage_failure'
  | 'compile_failure'
  | 'internal';

export interface AppErrorJSON {
  readonly kind: AppErrorKind;
  readonly message: string;
  readonly detail?: unknown;
  readonly cause?: { message: string; name?: string };
}

export class AppError extends Error {
  readonly kind: AppErrorKind;
  readonly detail: unknown;
  override readonly cause?: Error;

  constructor(
    kind: AppErrorKind,
    message: string,
    options: { detail?: unknown; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.kind = kind;
    this.detail = options.detail;
    if (options.cause instanceof Error) {
      this.cause = options.cause;
    } else if (options.cause !== undefined) {
      this.cause = new Error(String(options.cause));
    }
  }

  toJSON(): AppErrorJSON {
    return {
      kind: this.kind,
      message: this.message,
      ...(this.detail !== undefined ? { detail: this.detail } : {}),
      ...(this.cause
        ? { cause: { message: this.cause.message, ...(this.cause.name ? { name: this.cause.name } : {}) } }
        : {}),
    };
  }

  /** Map this error to an HTTP status code. */
  toStatusCode(): number {
    switch (this.kind) {
      case 'validation':
        return 400;
      case 'unauthorized':
        return 401;
      case 'forbidden':
        return 403;
      case 'not_found':
        return 404;
      case 'conflict':
        return 409;
      case 'rate_limited':
        return 429;
      case 'external_unavailable':
      case 'external_timeout':
        return 502;
      case 'external_invalid_response':
      case 'storage_failure':
      case 'compile_failure':
      case 'internal':
        return 500;
    }
  }
}

export const Errors = {
  validation: (message: string, detail?: unknown): AppError =>
    new AppError('validation', message, detail !== undefined ? { detail } : {}),
  notFound: (message: string, detail?: unknown): AppError =>
    new AppError('not_found', message, detail !== undefined ? { detail } : {}),
  unauthorized: (message = 'unauthorized'): AppError => new AppError('unauthorized', message),
  forbidden: (message = 'forbidden'): AppError => new AppError('forbidden', message),
  conflict: (message: string, detail?: unknown): AppError =>
    new AppError('conflict', message, detail !== undefined ? { detail } : {}),
  rateLimited: (message = 'rate limit exceeded'): AppError => new AppError('rate_limited', message),
  externalUnavailable: (message: string, cause?: unknown): AppError =>
    new AppError('external_unavailable', message, cause !== undefined ? { cause } : {}),
  externalTimeout: (message: string): AppError => new AppError('external_timeout', message),
  externalInvalidResponse: (message: string, detail?: unknown): AppError =>
    new AppError('external_invalid_response', message, detail !== undefined ? { detail } : {}),
  storage: (message: string, cause?: unknown): AppError =>
    new AppError('storage_failure', message, cause !== undefined ? { cause } : {}),
  compile: (message: string, cause?: unknown): AppError =>
    new AppError('compile_failure', message, cause !== undefined ? { cause } : {}),
  internal: (message: string, cause?: unknown): AppError =>
    new AppError('internal', message, cause !== undefined ? { cause } : {}),
} as const;
