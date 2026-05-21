import { SignJWT, jwtVerify } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { UserRecord } from '@openxiv/db';

export const SESSION_COOKIE = 'openxiv_session';

export interface SessionPayload {
  uid: string;
  did: string;
  role: string;
  iat?: number;
  exp?: number;
}

const secretToKey = (secret: string): Uint8Array => new TextEncoder().encode(secret);

export async function signSession(secret: string, user: UserRecord, ttlSec: number): Promise<string> {
  return new SignJWT({ uid: user.id, did: user.did, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSec)
    .sign(secretToKey(secret));
}

export async function verifySession(secret: string, token: string): Promise<SessionPayload> {
  // Pin the algorithm explicitly. Without this, jose accepts any HS* algorithm
  // the token's header advertises — an attacker who can substitute a token
  // signed with HS512 (or other strong-but-unexpected HMAC) would otherwise
  // pass verification, weakening the alg-confusion posture.
  const { payload } = await jwtVerify(token, secretToKey(secret), { algorithms: ['HS256'] });
  return payload as unknown as SessionPayload;
}

const isProduction = (): boolean => process.env['NODE_ENV'] === 'production';

const cookieBase = (): {
  path: '/';
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
} => ({
  path: '/',
  httpOnly: true,
  sameSite: 'lax',
  secure: isProduction(),
});

export function setSessionCookie(reply: FastifyReply, token: string, ttlSec: number): void {
  reply.setCookie(SESSION_COOKIE, token, { ...cookieBase(), maxAge: ttlSec });
}

/**
 * Browsers will only honour a clear if the attributes (path, domain, secure,
 * sameSite) match those used to set the cookie — mismatched flags leave the
 * stale session cookie in place. Mirror setSessionCookie exactly.
 */
export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, cookieBase());
}

export function readSessionCookie(req: FastifyRequest): string | undefined {
  const c = req.cookies?.[SESSION_COOKIE];
  return typeof c === 'string' ? c : undefined;
}
