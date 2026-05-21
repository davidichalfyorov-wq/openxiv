#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateMastodonLivePreflightEnv } from './mastodon_live_preflight_lib.mjs';

const env = { ...loadEnvFile('.env.e2e-live.local'), ...process.env };

try {
  const errors = validateMastodonLivePreflightEnv(env);
  if (errors.length) {
    throw new Error(`missing or invalid Mastodon live inputs:\n- ${errors.join('\n- ')}`);
  }

  const base = env.E2E_BASE_URL.replace(/\/$/, '');
  const cookie = env.E2E_OPENXIV_SESSION_COOKIE;

  const me = await getJson(`${base}/api-proxy/auth/me`, {
    cookie,
    accept: 'application/json',
  });
  if (!me.authenticated || !me.user?.id || !me.user?.did) {
    throw new Error('E2E_OPENXIV_SESSION_COOKIE is not authenticated');
  }

  const links = await getJson(`${base}/api-proxy/me/links`, {
    cookie,
    accept: 'application/json',
  });
  const link = links.links?.find((item) => item.provider === 'mastodon');
  if (!link?.mastodonInstanceUrl) {
    throw new Error('OpenXiv user is not linked to a Mastodon account');
  }

  if (env.MASTODON_ACCESS_TOKEN) {
    await getText(`${String(link.mastodonInstanceUrl).replace(/\/$/, '')}/api/v1/accounts/verify_credentials`, {
      authorization: `Bearer ${env.MASTODON_ACCESS_TOKEN}`,
      accept: 'application/json',
    });
  }

  console.log(`mastodon_live_preflight|ok|user=${me.user.id}|instance=${link.mastodonInstanceUrl}`);
} catch (err) {
  console.error(`mastodon live preflight: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

async function getJson(url, headers) {
  const text = await getText(url, headers);
  return JSON.parse(text);
}

async function getText(url, headers) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${url} failed ${res.status}: ${text.slice(0, 300)}`);
  }
  return text;
}

function loadEnvFile(path) {
  const full = resolve(process.cwd(), path);
  if (!existsSync(full)) return {};
  const out = {};
  for (const line of readFileSync(full, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match) continue;
    const name = match[1];
    const rawValue = match[2];
    if (!name || rawValue === undefined) continue;
    out[name] = unquote(rawValue.trim());
  }
  return out;
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    const inner = value.slice(1, -1);
    return value.startsWith('"')
      ? inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      : inner;
  }
  return value;
}
