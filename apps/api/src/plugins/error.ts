import fp from 'fastify-plugin';
import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { AppError, Errors } from '@openxiv/shared';
import { captureError } from '../services/error-tracking.js';

/**
 * Centralised error handler: convert AppError, zod validation errors, and
 * unknown throws into a uniform JSON shape. Internal-error messages are
 * scrubbed in production so postgres/S3/library detail never reaches the
 * client — the full error still goes to the structured log.
 */
export const errorPlugin = fp(async (app: FastifyInstance) => {
  const isProduction = app.ctx.env.NODE_ENV === 'production';

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      request.log.warn({ kind: error.kind, msg: error.message }, 'AppError');
      reply.status(error.toStatusCode()).send(error.toJSON());
      return;
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      const appErr = Errors.validation('request validation failed', error.validation);
      request.log.warn({ issues: error.validation }, 'validation');
      reply.status(appErr.toStatusCode()).send(appErr.toJSON());
      return;
    }

    const statusCode = error.statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      // 4xx from Fastify (body limit, malformed JSON, etc) — message is safe.
      reply.status(statusCode).send({
        kind: 'validation',
        message: error.message,
      });
      return;
    }

    // 5xx and unknowns: log the full error, return a generic message in prod
    // and a request-correlated reference id for support.
    captureError(error, request);
    request.log.error({ err: error, reqId: request.id }, 'unhandled');
    const publicMessage = isProduction
      ? `internal error (ref ${request.id})`
      : error.message || 'internal error';
    reply.status(500).send(Errors.internal(publicMessage).toJSON());
  });

  // Backstop for routes that never produce a 404 (the default Fastify
  // 404 page leaks "Route not found" plus stack on some configs).
  app.setNotFoundHandler((req, reply) => {
    req.log.info({ url: req.url }, 'route not found');
    reply.status(404).send(Errors.notFound('route not found').toJSON());
  });
});
