import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '@openxiv/shared';
import {
  isReservedHandle,
  validateHandleShape,
} from '../services/reserved-handles.js';
import { impersonationRisk } from '../services/impersonation.js';
import { sanitizePlainText } from '../services/sanitize.js';
import type { AppContext } from '../context.js';

/**
 * Handle bootstrap endpoints.
 *
 *   GET  /me/handle/check?candidate=<x>  → live availability/validity check
 *   POST /me/handle                       → claim a handle for the logged-in user
 *
 * Both routes require an authenticated session — the handle is bound to a
 * single user record, so anon access is a 401.
 *
 * The check endpoint deliberately exposes WHY a candidate is rejected
 * (reserved vs taken vs invalid vs impersonation) so the UI can render a
 * useful message rather than a generic "no".
 */

export type HandleCheckReason =
  | 'too_short'
  | 'too_long'
  | 'invalid_chars'
  | 'all_numeric'
  | 'did_shape'
  | 'reserved'
  | 'impersonation'
  | 'taken';

export async function handleRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  app.get(
    '/me/handle/check',
    {
      schema: {
        querystring: z.object({ candidate: z.string().min(1).max(80) }),
      },
    },
    async (req, reply) => {
      const session = req.session;
      if (!session) {
        reply.status(401);
        return { kind: 'unauthorized' as const };
      }
      const candidate = (req.query as { candidate: string }).candidate;
      const result = await checkAvailability(ctx, candidate);
      reply.status(200);
      return result;
    },
  );

  app.post(
    '/me/handle',
    {
      schema: {
        body: z.object({ handle: z.string().min(1).max(80) }),
      },
    },
    async (req, reply) => {
      const session = req.session;
      if (!session) {
        reply.status(401);
        return { kind: 'unauthorized' as const };
      }
      const candidate = (req.body as { handle: string }).handle;
      const status = await checkAvailability(ctx, candidate);
      if (!status.available) {
        reply.status(status.reason === 'taken' ? 409 : status.reason === 'reserved' || status.reason === 'impersonation' ? 403 : 400);
        return status;
      }
      const handle = status.handle;
      const updated = await ctx.repos.users.setHandle(session.uid, handle);
      if (updated.isErr()) {
        // Race: someone else claimed it between check and set. Surface as 409.
        if ((updated.error.cause as { code?: string } | undefined)?.code === '23505') {
          reply.status(409);
          return { available: false, reason: 'taken' as const };
        }
        throw updated.error;
      }
      reply.status(200);
      return { available: true, handle };
    },
  );
}

interface AvailabilityOk {
  available: true;
  handle: string;
}
interface AvailabilityNo {
  available: false;
  reason: HandleCheckReason;
}
type Availability = AvailabilityOk | AvailabilityNo;

/**
 * Pure-ish: only the `taken` check touches the DB. Exported for tests.
 */
export async function checkAvailability(
  ctx: AppContext,
  candidate: string,
): Promise<Availability> {
  const shape = validateHandleShape(sanitizePlainText(candidate));
  if (!shape.ok) return { available: false, reason: shape.reason };
  if (impersonationRisk(shape.handle) === 'high') {
    return { available: false, reason: 'impersonation' };
  }
  const existing = await ctx.repos.users.findByHandle(shape.handle);
  if (existing.isErr()) {
    return { available: false, reason: 'taken' };
  }
  if (existing.value) return { available: false, reason: 'taken' };
  return { available: true, handle: shape.handle };
}

void isReservedHandle; // re-exported indirectly via validateHandleShape
void Errors; // surfaced via repo wrapper
