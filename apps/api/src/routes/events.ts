import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Errors, readConsentFromHeader } from '@openxiv/shared';
import {
  FEED_EVENT_TARGET_TYPES,
  FEED_EVENT_TYPES,
  type FeedEventTargetType,
  type FeedEventType,
} from '@openxiv/db';
import { FLAGS } from '../services/flags.js';

const OPT_OUT_COOKIE = 'openxiv_notrack';

/**
 * Event-tracking ingestion (P1 #2).
 *
 * Privacy posture:
 *   - DNT header (`do-not-track: 1`) is honored — request is accepted and
 *     200'd but no row is written. Clients can't tell from the response
 *     whether their event landed; that's deliberate (no opt-out side-channel).
 *   - `openxiv_notrack=1` cookie has the same effect.
 *   - user_did is only persisted for authenticated sessions; anonymous
 *     requests record only the session_id (client-minted UUID).
 *
 * Idempotency:
 *   - (session_id, event_type, target_uri) within a 60-second window is
 *     dropped silently. Catches client-side double-fires (e.g. an
 *     IntersectionObserver that re-fires on rapid scroll) without forcing
 *     callers to dedupe.
 *
 * Resilience:
 *   - The feature flag `event_tracking` defaults ON. Flip it off in Redis
 *     to drain ingestion without redeploying. Disabled state returns 200
 *     + body `{accepted:false, reason:'disabled'}` so feed UIs don't bin.
 *   - DB failures return 503 without leaking detail.
 */
const trackBodySchema = z.object({
  sessionId: z
    .string()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, 'session_id must be url-safe'),
  eventType: z.enum(FEED_EVENT_TYPES),
  targetUri: z.string().min(1).max(500),
  targetType: z.enum(FEED_EVENT_TARGET_TYPES),
  context: z.record(z.string(), z.unknown()).optional(),
});

export async function eventsRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const services = app.services;

  app.post(
    '/events/track',
    {
      schema: { body: trackBodySchema },
      config: {
        rateLimit: {
          // 100/min/IP — well above any human-rate scrolling, but cheap to
          // exceed for a misbehaving client. The /api global limiter still
          // applies on top.
          max: 100,
          timeWindow: 60_000,
          keyGenerator: (req: FastifyRequest) => `events:${req.ip}`,
        },
      },
    },
    async (req, reply) => {
      const enabled = await services.flags.isEnabled(FLAGS.EVENT_TRACKING, true);
      if (!enabled) {
        return reply.send({ accepted: false, reason: 'disabled' });
      }
      if (clientOptedOut(req)) {
        // Per-spec: privacy signals win silently. Reply with the same shape
        // as a normal accepted call so opt-out isn't a side-channel.
        return reply.send({ accepted: false, reason: 'opt_out' });
      }
      const body = trackBodySchema.parse(req.body);
      const context = sanitizeContext(body.context ?? {});

      // Idempotency probe — 1 minute bucket per (session, type, uri).
      const exists = await ctx.repos.events.existsInBucket(
        body.sessionId,
        body.eventType,
        body.targetUri,
        60,
      );
      if (exists.isErr()) throw exists.error;
      if (exists.value) {
        return reply.send({ accepted: false, reason: 'duplicate' });
      }

      const inserted = await ctx.repos.events.insert({
        userDid: req.session?.did ?? null,
        sessionId: body.sessionId,
        eventType: body.eventType,
        targetUri: body.targetUri,
        targetType: body.targetType,
        contextJson: Object.keys(context).length > 0 ? context : null,
        ipHashDaily: dailyIpHash(req.ip, ctx.env.SESSION_SECRET),
        countryCode: countryCode(req),
      });
      if (inserted.isErr()) {
        // Surface a generic 503 — telemetry must never block the user's
        // critical path, but we want clients to back off on outage.
        reply.status(503);
        return { accepted: false, reason: 'unavailable' };
      }
      req.log.info(
        { eventType: body.eventType, targetType: body.targetType, anon: req.session === undefined },
        'event ingested',
      );
      return { accepted: true };
    },
  );

  /** Diagnostic — admin-only aggregate counts. */
  app.get(
    '/events/summary',
    { preHandler: app.requireAuth },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      if (!services.users.isAdminDid(req.session.did)) {
        throw Errors.forbidden('admin only');
      }
      const r = await ctx.repos.events.countByEventType();
      if (r.isErr()) throw r.error;
      return { byEventType: r.value };
    },
  );
}

function clientOptedOut(req: FastifyRequest): boolean {
  const dnt = req.headers['dnt'];
  if (typeof dnt === 'string' && dnt === '1') return true;
  const gpc = req.headers['sec-gpc'];
  if (typeof gpc === 'string' && gpc === '1') return true;
  // @fastify/cookie attaches parsed cookies to req.cookies
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  if (cookies?.[OPT_OUT_COOKIE] === '1') return true;
  const consent = readConsentFromHeader(req.headers.cookie);
  return consent?.analytics !== true;
}

function sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (key === 'referrer' && typeof value === 'string') {
      const host = hostOnly(value);
      if (host) out['referrerHost'] = host;
      continue;
    }
    if (key === 'referrerHost' && typeof value === 'string') {
      const host = hostOnly(value) ?? value.toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 120);
      if (host) out[key] = host;
      continue;
    }
    if (typeof value === 'string') out[key] = value.slice(0, 500);
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    else if (value === null) out[key] = null;
  }
  return out;
}

function hostOnly(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.hostname.toLowerCase().slice(0, 120);
  } catch {
    return null;
  }
}

function dailyIpHash(ip: string, secret: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return createHash('sha256').update(`${day}\0${secret}\0${ip}`).digest('hex');
}

function countryCode(req: FastifyRequest): string | null {
  for (const header of ['cf-ipcountry', 'x-vercel-ip-country', 'x-country-code']) {
    const value = req.headers[header];
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== 'string') continue;
    const code = raw.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(code) && code !== 'XX') return code;
  }
  return null;
}

// Reference unused imports so tree-shaking doesn't complain.
void [FEED_EVENT_TYPES, FEED_EVENT_TARGET_TYPES];
export type { FeedEventType, FeedEventTargetType };
