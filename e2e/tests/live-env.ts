import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function loadLiveEnv(): void {
  loadEnvFileIfPresent(path.resolve(process.cwd(), '.env.e2e-live.local'));
  loadEnvFileIfPresent(path.resolve(process.cwd(), '..', '.env.e2e-live.local'));
}

export function requireProductionOpenXivBaseUrl(): void {
  const raw = process.env['E2E_BASE_URL'] ?? 'http://localhost:4321';
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`live OpenXiv e2e requires E2E_BASE_URL=https://openxiv.net; got ${raw}`);
  }
  if (parsed.protocol !== 'https:' || parsed.host !== 'openxiv.net') {
    throw new Error(`live OpenXiv e2e requires E2E_BASE_URL=https://openxiv.net; got ${raw}`);
  }
}

function loadEnvFileIfPresent(filePath: string): void {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match) continue;
    const name = match[1];
    const rawValue = match[2];
    if (!name || rawValue === undefined) continue;
    if (process.env[name]) continue;
    process.env[name] = unquoteEnvValue(rawValue.trim());
  }
}

function unquoteEnvValue(value: string): string {
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
