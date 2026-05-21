import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Errors, detectLatexEntry, fromPromise } from '@openxiv/shared';
import type { ConvertInput, LatexmlConverter } from './interface.js';

export interface LatexmlConfig {
  /** @deprecated Native worker execution no longer uses an external image. */
  readonly dockerImage?: string;
  readonly timeoutMs: number;
}

interface CommandSpec {
  readonly command: string;
  readonly args: readonly string[];
}

interface LatexmlCommandPlan {
  readonly latexml: CommandSpec;
  readonly latexmlpost: CommandSpec;
  readonly htmlPath: string;
}

export function makeLatexmlConverter(cfg: LatexmlConfig): LatexmlConverter {
  return {
    convertToHtml(input: ConvertInput) {
      return fromPromise(runOnce(cfg, input), (cause) =>
        Errors.externalInvalidResponse('latexml convert failed', cause),
      );
    },
  };
}

async function runOnce(
  cfg: LatexmlConfig,
  input: ConvertInput,
): Promise<{ html: Buffer; log: string }> {
  const workdir = await mkdtemp(path.join(os.tmpdir(), 'openxiv-latexml-'));
  try {
    const mainTex = await materializeSource(workdir, input);
    const outdir = path.join(workdir, 'out');
    await mkdir(outdir, { recursive: true });
    const plan = buildLatexmlCommandPlan(mainTex, outdir);

    const xml = await runProcess(plan.latexml.command, plan.latexml.args, {
      cwd: path.dirname(mainTex),
      timeoutMs: cfg.timeoutMs,
    });
    if (xml.code !== 0) throw new Error(`latexml exited ${xml.code}\n${xml.log.slice(-4000)}`);

    const post = await runProcess(plan.latexmlpost.command, plan.latexmlpost.args, {
      cwd: path.dirname(mainTex),
      timeoutMs: cfg.timeoutMs,
    });
    if (post.code !== 0) throw new Error(`latexmlpost exited ${post.code}\n${post.log.slice(-4000)}`);

    const html = await readFile(plan.htmlPath);
    const log = [xml.log, post.log].filter(Boolean).join('\n');
    return { html, log };
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

async function materializeSource(workdir: string, input: ConvertInput): Promise<string> {
  if (/\.(tar\.gz|tgz|tar)$/i.test(input.filename)) {
    const gzipped = /\.(tar\.gz|tgz)$/i.test(input.filename);
    const archive = path.join(workdir, gzipped ? 'src.tar.gz' : 'src.tar');
    await writeFile(archive, input.source);
    await execAndWait('tar', [gzipped ? '-xzf' : '-xf', archive, '-C', workdir], 60_000);
    return findTopLevelTex(workdir);
  }
  if (/\.zip$/i.test(input.filename)) {
    const archive = path.join(workdir, 'src.zip');
    await writeFile(archive, input.source);
    await execAndWait('unzip', ['-q', archive, '-d', workdir], 60_000);
    return findTopLevelTex(workdir);
  }
  const file = path.join(workdir, 'main.tex');
  await writeFile(file, input.source);
  return file;
}

async function findTopLevelTex(workdir: string): Promise<string> {
  interface Candidate {
    absPath: string;
    path: string;
    content: string;
  }
  const candidates: Candidate[] = [];

  async function walk(dir: string, relRoot: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = relRoot ? `${relRoot}/${entry.name}` : entry.name;
      if (entry.isFile() && /\.tex$/i.test(entry.name)) {
        const content = await readFile(abs, 'utf8').catch(() => '');
        candidates.push({ absPath: abs, path: rel, content });
      } else if (entry.isDirectory()) {
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

function buildLatexmlCommandPlan(mainTex: string, outdir: string): LatexmlCommandPlan {
  const base = path.basename(mainTex, path.extname(mainTex)) || 'main';
  const xmlPath = joinLike(outdir, `${base}.xml`);
  const htmlPath = joinLike(outdir, `${base}.html`);
  return {
    latexml: {
      command: 'latexml',
      args: [`--dest=${xmlPath}`, mainTex],
    },
    latexmlpost: {
      command: 'latexmlpost',
      args: [`--dest=${htmlPath}`, '--format=html5', '--pmml', '--mathtex', xmlPath],
    },
    htmlPath,
  };
}

function joinLike(dir: string, leaf: string): string {
  const trimmed = dir.replace(/[\\/]+$/, '');
  const sep = dir.includes('\\') ? '\\' : '/';
  return `${trimmed}${sep}${leaf}`;
}

function runProcess(
  command: string,
  args: readonly string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<{ code: number; log: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      if (!settled) {
        settled = true;
        reject(new Error(`${command} timeout after ${opts.timeoutMs}ms`));
      }
    }, opts.timeoutMs);
    child.stdout.on('data', (b: Buffer) => out.push(b));
    child.stderr.on('data', (b: Buffer) => err.push(b));
    child.on('error', (e) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(e);
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const log = Buffer.concat([...out, ...err]).toString('utf8');
      resolve({ code: code ?? -1, log });
    });
  });
}

function execAndWait(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return runProcess(cmd, args, { cwd: process.cwd(), timeoutMs }).then((result) => {
    if (result.code !== 0) throw new Error(`${cmd} exited ${result.code}: ${result.log.slice(-4000)}`);
  });
}

export const __latexmlTesting = {
  buildLatexmlCommandPlan,
};
