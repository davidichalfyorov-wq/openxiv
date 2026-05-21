import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { FileNode } from './tex-detect.js';

/**
 * Extract a `.zip` / `.tar.gz` / `.tgz` archive into a temp dir and
 * return the file tree as `FileNode[]` for in-memory inspection
 * (tex-detect + companion-check).
 *
 * `.tex` files have their UTF-8 contents read into memory. Binary
 * files (figures, .bib, fonts) keep an empty `content` field — the
 * detection layer only needs to know they EXIST under their path.
 *
 * This duplicates a slice of the compiler client's extraction
 * (`packages/clients/src/compiler/tectonic.ts`) — we don't share
 * the code because the API process and the worker process run in
 * different layers, and pulling a runtime dep from `clients` here
 * would invert that layer boundary.
 *
 * Throws `Error('malformed_archive')` on extraction failure so the
 * caller can map it to a user-message cleanly.
 */
export async function extractToFileNodes(
  bytes: Buffer,
  filename: string,
): Promise<FileNode[]> {
  const work = await mkdtemp(join(tmpdir(), 'openxiv-extract-'));
  try {
    if (/\.(tar\.gz|tgz|tar)$/i.test(filename)) {
      const gzipped = /\.(tar\.gz|tgz)$/i.test(filename);
      const arc = join(work, gzipped ? 'src.tar.gz' : 'src.tar');
      await writeFile(arc, bytes);
      await run('tar', [gzipped ? '-xzf' : '-xf', arc, '-C', work], 60_000);
    } else if (/\.zip$/i.test(filename)) {
      const arc = join(work, 'src.zip');
      await writeFile(arc, bytes);
      await extractZip(arc, work);
    } else {
      // Single .tex (or unknown text) — wrap as one-file tree.
      const single = join(work, filename || 'main.tex');
      await writeFile(single, bytes);
    }
    return await walk(work, work);
  } catch {
    throw new Error('malformed_archive');
  } finally {
    rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

async function walk(root: string, dir: string): Promise<FileNode[]> {
  const out: FileNode[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walk(root, abs)));
      continue;
    }
    if (!e.isFile()) continue;
    const rel = relative(root, abs).replaceAll('\\', '/');
    // Skip the archive file itself if it slipped through (we don't
    // want `src.tar.gz` confused with a manuscript).
    if (rel === 'src.tar.gz' || rel === 'src.tar' || rel === 'src.zip') continue;
    // Keep bounded raw bytes so downstream enrichment can inspect
    // source figures from arbitrary archive layouts. Text conversion is
    // still extension-capped to avoid decoding multi-MB binaries.
    let bytes: Buffer | undefined;
    try {
      const stats = await stat(abs);
      if (stats.size <= 25 * 1024 * 1024) {
        bytes = await readFile(abs);
      }
    } catch {
      bytes = undefined;
    }

    // Read only text-ish files. We cap by extension to avoid pulling
    // multi-MB binaries into JS strings.
    const isText = /\.(tex|bib|cls|sty|md|txt|json|toml|yaml|yml)$/i.test(e.name);
    let content = '';
    if (isText && bytes && bytes.length <= 4 * 1024 * 1024) {
      content = bytes.toString('utf-8');
    }
    out.push({ path: rel, content, ...(bytes ? { bytes } : {}) });
  }
  return out;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (b: Buffer) => {
      stderr += b.toString();
      if (stderr.length > 4096) stderr = stderr.slice(-4096);
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${cmd} timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exit ${code}: ${stderr.trim()}`));
    });
  });
}

async function extractZip(archive: string, workdir: string): Promise<void> {
  try {
    await run('unzip', ['-q', '-o', archive, '-d', workdir], 60_000);
  } catch (err) {
    if (!isMissingExecutable(err)) throw err;
    await run('tar', ['-xf', archive, '-C', workdir], 60_000);
  }
}

function isMissingExecutable(err: unknown): boolean {
  return (
    err instanceof Error &&
    'code' in err &&
    (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
