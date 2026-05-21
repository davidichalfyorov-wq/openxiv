import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Errors, detectLatexEntry, fromPromise } from '@openxiv/shared';
import type { CompileInput, CompileResult, LatexCompiler } from './interface.js';

export interface TectonicConfig {
  /**
   * @deprecated Kept for back-compat with the factory; ignored in the
   * native-spawn implementation. The previous Docker-out-of-Docker
   * shim mounted this image and called an entrypoint script inside;
   * we now exec the `tectonic` binary installed in the worker image
   * directly (apps/api/Dockerfile `apk add tectonic`).
   */
  readonly dockerImage?: string;
  readonly timeoutMs: number;
  /** Number of process attempts for transient Tectonic/cache/network failures. */
  readonly retryAttempts?: number;
}

/**
 * Compile LaTeX via the `tectonic` binary installed in the worker
 * container.
 *
 * Why native spawn (not DooD): the previous design tried to mount
 * `/var/run/docker.sock` and spawn an `openxiv/tectonic` image. That
 * needs an image to exist on the host, plus permission to talk to the
 * Docker daemon from inside a container — both fragile. The Alpine
 * community repo ships `tectonic` (Rust binary, ~30 MB) which we
 * install at image build time. The compile path becomes a single
 * `spawn('tectonic', ['-X', 'compile', ...])` with the source written
 * to a tmp dir.
 *
 * Source layouts handled:
 *   - Single `.tex` → wrap as `main.tex`.
 *   - `.tar.gz` / `.tgz` / `.tar` → extract into the workdir.
 *   - `.zip` → unzip into the workdir.
 *
 * Sandboxing: tectonic itself opens network connections to fetch the
 * TeXLive bundle on first compile (then caches to ~/.cache/Tectonic).
 * We *don't* run it with `--no-network` for that reason — the build
 * would fail on a fresh worker container without the cache. Subsequent
 * compiles reuse the cache and are network-free.
 *
 * Resource caps live at the container level (cgroup memory limit),
 * plus a per-compile timeout enforced by SIGKILL.
 */
export function makeTectonicCompiler(cfg: TectonicConfig): LatexCompiler {
  return {
    compile(input: CompileInput) {
      return fromPromise(runOnce(cfg, input), (cause) =>
        Errors.compile('tectonic compile failed', cause),
      );
    },
  };
}

async function runOnce(cfg: TectonicConfig, input: CompileInput): Promise<CompileResult> {
  const workdir = await mkdtemp(path.join(os.tmpdir(), 'openxiv-tect-'));
  const started = Date.now();
  try {
    const mainTex = await materializeSource(workdir, input);
    await prepareNestedEntryAliases(mainTex, workdir);
    const cacheDir = await ensureTectonicCacheDir();
    const result = await runTectonicWithRetry(
      mainTex,
      workdir,
      cfg.timeoutMs,
      cfg.retryAttempts ?? 2,
      cacheDir,
    );
    const pdf = await readGeneratedPdf(workdir, mainTex);
    return { pdf, log: result.log, durationMs: Date.now() - started };
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Write the source bytes to disk and return the absolute path to the
 * top-level `.tex` file we'll hand to tectonic.
 */
async function materializeSource(workdir: string, input: CompileInput): Promise<string> {
  if (/\.(tar\.gz|tgz|tar)$/i.test(input.filename)) {
    const gzipped = /\.(tar\.gz|tgz)$/i.test(input.filename);
    const archive = path.join(workdir, gzipped ? 'src.tar.gz' : 'src.tar');
    await writeFile(archive, input.source);
    await execAndWait('tar', [gzipped ? '-xzf' : '-xf', archive, '-C', workdir], 60_000);
    return await findTopLevelTex(workdir);
  }
  if (/\.zip$/i.test(input.filename)) {
    const archive = path.join(workdir, 'src.zip');
    await writeFile(archive, input.source);
    await extractZip(archive, workdir);
    return await findTopLevelTex(workdir);
  }
  // Single .tex (or unknown) — treat as `main.tex`.
  const file = path.join(workdir, 'main.tex');
  await writeFile(file, input.source);
  return file;
}

/** Locate the entrypoint `.tex` inside an extracted archive. */
async function findTopLevelTex(workdir: string): Promise<string> {
  interface Candidate {
    absPath: string;
    path: string;
    content: string;
  }
  const candidates: Candidate[] = [];

  async function walk(dir: string, relRoot: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = relRoot ? `${relRoot}/${e.name}` : e.name;
      if (e.isFile() && /\.tex$/i.test(e.name)) {
        const content = await readFile(abs, 'utf-8').catch(() => '');
        candidates.push({ absPath: abs, path: rel, content });
      } else if (e.isDirectory()) {
        await walk(abs, rel);
      }
    }
  }
  await walk(workdir, '');

  const selected = detectLatexEntry(candidates);
  if (selected.ok) return selected.entry.absPath;
  if (selected.error === 'multiple_documentclass') {
    throw new Error(`multiple_documentclass:${selected.files.join(',')}`);
  }
  throw new Error('no_documentclass');
}

async function prepareNestedEntryAliases(mainTex: string, workdir: string): Promise<void> {
  const entryDir = path.dirname(mainTex);
  if (path.resolve(entryDir) === path.resolve(workdir)) return;

  const relativeEntry = path.relative(workdir, mainTex);
  if (!relativeEntry || relativeEntry.startsWith('..') || path.isAbsolute(relativeEntry)) return;
  const [entryTopLevel] = relativeEntry.split(path.sep);
  if (!entryTopLevel) return;

  const rootEntries = await readdir(workdir, { withFileTypes: true });
  for (const rootEntry of rootEntries) {
    if (rootEntry.name === entryTopLevel) continue;
    if (/^src\.(?:zip|tar|tar\.gz)$/i.test(rootEntry.name)) continue;

    const source = path.join(workdir, rootEntry.name);
    const target = path.join(entryDir, rootEntry.name);
    if (await pathExists(target)) continue;

    try {
      await symlink(
        source,
        target,
        rootEntry.isDirectory() ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file',
      );
    } catch {
      await cp(source, target, { recursive: rootEntry.isDirectory(), errorOnExist: false });
    }
  }
}

async function pathExists(candidate: string): Promise<boolean> {
  return Boolean(await lstat(candidate).catch(() => null));
}

function basenameNoExt(p: string): string {
  return path.basename(p, path.extname(p));
}

async function readGeneratedPdf(workdir: string, mainTex: string): Promise<Buffer> {
  const expected = [
    path.join(workdir, basenameNoExt(mainTex) + '.pdf'),
    path.join(path.dirname(mainTex), basenameNoExt(mainTex) + '.pdf'),
  ];
  for (const candidate of expected) {
    const stats = await stat(candidate).catch(() => null);
    if (stats?.isFile() && stats.size > 0) return readFile(candidate);
  }
  throw new Error(`tectonic produced no PDF for ${path.basename(mainTex)} (workdir=${workdir})`);
}

export type TectonicFailureKind = 'oom' | 'failure';

export interface TectonicProcessResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly log: string;
}

interface TectonicCommandPlan {
  readonly cwd: string;
  readonly args: string[];
  readonly searchRoots: string[];
}

export interface TectonicFailureClassification {
  readonly kind: TectonicFailureKind;
  readonly message: string;
}

export function classifyTectonicFailure(
  result: TectonicProcessResult,
): TectonicFailureClassification {
  const logTail = result.log.slice(-4000).toLowerCase();
  const killedByResourceLimit =
    result.code === 137 ||
    result.signal === 'SIGKILL' ||
    /\b(out of memory|oom-kill|oom killed|cannot allocate memory)\b/.test(logTail);

  if (killedByResourceLimit) {
    return { kind: 'oom', message: 'tectonic killed by resource limit' };
  }

  if (result.signal) {
    return { kind: 'failure', message: `tectonic exited with signal ${result.signal}` };
  }

  return { kind: 'failure', message: `tectonic exited ${result.code ?? -1}` };
}

export function isTransientTectonicFailure(result: TectonicProcessResult): boolean {
  if (classifyTectonicFailure(result).kind === 'oom') return false;

  const log = result.log.slice(-8000).toLowerCase();
  const hasTransientNetworkFailure =
    /(failed to download|error downloading|failed to fetch|failure requesting|network error|temporarily unavailable|temporary failure|timed out|timeout|connection reset|connection refused|could not resolve|dns|tls|certificate|error trying to connect|error sending request|security package|schannel|handshake)/i.test(
      log,
    );
  if (hasTransientNetworkFailure) return true;

  if (
    /(! latex error|undefined control sequence|emergency stop|file `[^`]+['`] not found|i can'?t find file|missing \\begin\{document\})/i.test(
      result.log,
    )
  ) {
    return false;
  }

  return /(resource busy|cache.*lock|lock.*cache|i\/o error)/i.test(
    log,
  );
}

function shouldTryAlternateCompileRoot(result: TectonicProcessResult): boolean {
  if (classifyTectonicFailure(result).kind === 'oom') return false;
  if (isTransientTectonicFailure(result)) return false;

  return /file [`'][^`']+['`] not found|i can'?t find file|no file .*?\.(?:tex|sty|cls|bib|bst|pdf|png|jpe?g|eps|svg)/i.test(
    result.log,
  );
}

async function runTectonicWithRetry(
  mainTex: string,
  workdir: string,
  timeoutMs: number,
  attempts: number,
  cacheDir: string,
): Promise<TectonicProcessResult> {
  const maxAttempts = Math.max(1, attempts);
  const plans = buildTectonicCommandPlans(mainTex, workdir);
  let lastResult: TectonicProcessResult | null = null;

  for (let planIndex = 0; planIndex < plans.length; planIndex++) {
    const plan = plans[planIndex]!;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await runTectonic(plan, timeoutMs, cacheDir);
      lastResult = result;
      if (result.code === 0) return result;

      if (attempt < maxAttempts && isTransientTectonicFailure(result)) {
        await delay(750 * attempt);
        continue;
      }

      break;
    }

    if (
      planIndex < plans.length - 1 &&
      lastResult &&
      shouldTryAlternateCompileRoot(lastResult)
    ) {
      continue;
    }

    break;
  }

  const failure = classifyTectonicFailure(lastResult ?? { code: -1, signal: null, log: '' });
  throw new Error(`${failure.message}\n${lastResult?.log.slice(-4000) ?? ''}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureTectonicCacheDir(): Promise<string> {
  const requested = process.env['TECTONIC_CACHE_DIR'] ?? defaultTectonicCacheDir();
  try {
    await mkdir(requested, { recursive: true });
    await access(requested, fsConstants.W_OK);
    return requested;
  } catch {
    const fallback = path.join(os.tmpdir(), 'openxiv-tectonic-cache');
    await mkdir(fallback, { recursive: true });
    await access(fallback, fsConstants.W_OK);
    return fallback;
  }
}

function defaultTectonicCacheDir(): string {
  return process.platform === 'win32'
    ? path.join(os.tmpdir(), 'openxiv-tectonic-cache')
    : '/var/cache/tectonic';
}

async function extractZip(archive: string, workdir: string): Promise<void> {
  try {
    await execAndWait('unzip', ['-q', '-o', archive, '-d', workdir], 60_000);
  } catch (err) {
    if (!isMissingExecutable(err)) throw err;
    await execAndWait('tar', ['-xf', archive, '-C', workdir], 60_000);
  }
}

function isMissingExecutable(err: unknown): boolean {
  return (
    err instanceof Error &&
    'code' in err &&
    (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function buildTectonicCommandPlans(mainTex: string, workdir: string): TectonicCommandPlan[] {
  const entryDir = path.dirname(mainTex);
  const plans: TectonicCommandPlan[] = [
    {
      cwd: entryDir,
      args: buildTectonicArgs(workdir, path.basename(mainTex)),
      searchRoots: uniquePaths([entryDir, workdir]),
    },
  ];

  const relativeEntry = path.relative(workdir, mainTex);
  if (
    path.resolve(entryDir) !== path.resolve(workdir) &&
    relativeEntry &&
    !relativeEntry.startsWith('..') &&
    !path.isAbsolute(relativeEntry)
  ) {
    plans.push({
      cwd: workdir,
      args: buildTectonicArgs(workdir, relativeEntry),
      searchRoots: uniquePaths([workdir, entryDir]),
    });
  }

  return plans;
}

function buildTectonicArgs(workdir: string, entryArg: string): string[] {
  return ['-X', 'compile', '--outdir', workdir, '--keep-logs', entryArg];
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of paths) {
    const resolved = path.resolve(candidate);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
  }
  return out;
}

function buildTectonicEnvironment(
  plan: TectonicCommandPlan,
  cacheDir: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    // Pin a writable cache so concurrent compiles share TeXLive bundles.
    TECTONIC_CACHE_DIR: cacheDir,
    // Archives often mix `paper/main.tex` with shared root-level figures,
    // `.bib`, or local packages. Kpathsea's `//` suffix searches recursively.
    TEXINPUTS: buildKpathseaSearchPath(plan.searchRoots, baseEnv['TEXINPUTS']),
    BIBINPUTS: buildKpathseaSearchPath(plan.searchRoots, baseEnv['BIBINPUTS']),
    BSTINPUTS: buildKpathseaSearchPath(plan.searchRoots, baseEnv['BSTINPUTS']),
    TEXPICTS: buildKpathseaSearchPath(plan.searchRoots, baseEnv['TEXPICTS']),
  };
}

function buildKpathseaSearchPath(roots: string[], existing: string | undefined): string {
  const parts = uniquePaths(roots).map(kpathseaRecursiveRoot);
  parts.push(existing && existing.trim().length > 0 ? existing : '');
  return parts.join(path.delimiter);
}

function kpathseaRecursiveRoot(root: string): string {
  return `${path.resolve(root).replaceAll('\\', '/')}//`;
}

function runTectonic(
  plan: TectonicCommandPlan,
  timeoutMs: number,
  cacheDir: string,
): Promise<TectonicProcessResult> {
  return new Promise((resolve, reject) => {
    // `tectonic -X compile` is the V2 CLI. `--keep-logs` aids
    // debugging on failure. `--outdir` keeps the produced PDF in a
    // predictable location (the top of the workdir, regardless of
    // how deep the entry .tex was found).
    const child = spawn('tectonic', plan.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      // Start from the entry directory for normal relative paths. If
      // a nested archive keeps shared assets at the archive root, the
      // retry layer can run an alternate plan from `workdir`.
      cwd: plan.cwd,
      env: buildTectonicEnvironment(plan, cacheDir),
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`tectonic timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (b: Buffer) => out.push(b));
    child.stderr.on('data', (b: Buffer) => err.push(b));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      const log = Buffer.concat([...out, ...err]).toString('utf8');
      resolve({ code, signal, log });
    });
  });
}

function execAndWait(cmd: string, args: string[], timeoutMs: number): Promise<void> {
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
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.trim()}`));
    });
  });
}

export const __testing = {
  buildTectonicCommandPlans,
  buildTectonicEnvironment,
  findTopLevelTex,
  kpathseaRecursiveRoot,
  prepareNestedEntryAliases,
  shouldTryAlternateCompileRoot,
};
