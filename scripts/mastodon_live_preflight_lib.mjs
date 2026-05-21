const REQUIRED = [
  'E2E_OPENXIV_SESSION_COOKIE',
  'OPENXIV_HOST',
  'OPENXIV_USER',
];

export function validateMastodonLivePreflightEnv(env) {
  const errors = [];
  for (const name of REQUIRED) {
    if (!env[name]) errors.push(`missing ${name}`);
  }
  if (!env.OPENXIV_PASSWORD && !env.OPENXIV_KEYFILE) {
    errors.push('missing OPENXIV_PASSWORD or OPENXIV_KEYFILE');
  }
  if (!isProductionBase(env.E2E_BASE_URL)) {
    errors.push('E2E_BASE_URL must be https://openxiv.net');
  }
  const cookie = env.E2E_OPENXIV_SESSION_COOKIE ?? '';
  if (cookie && !/(^|;\s*)openxiv_session=/.test(cookie)) {
    errors.push('E2E_OPENXIV_SESSION_COOKIE must include openxiv_session=');
  }
  return errors;
}

function isProductionBase(raw) {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.host === 'openxiv.net';
  } catch {
    return false;
  }
}
