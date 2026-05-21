const LOCAL_WEB_BASE = 'http://localhost:4321';

export function publicWebBase(buildTimeBase?: string): string {
  const raw =
    (typeof process !== 'undefined' ? process.env?.PUBLIC_WEB_BASE : undefined) ||
    buildTimeBase ||
    LOCAL_WEB_BASE;
  return raw.replace(/\/+$/, '');
}
