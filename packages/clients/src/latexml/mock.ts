import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ResultAsync } from '@openxiv/shared';
import type { ConvertInput, LatexmlConverter } from './interface.js';

const TEMPLATE = (filename: string): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Source HTML preview</title>
</head>
<body>
  <article>
    <h1>Source HTML preview</h1>
    <p>OpenXiv could not inspect the TeX source for <code>${escapeHtml(filename)}</code>.</p>
    <p>The PDF remains the authoritative rendering.</p>
  </article>
</body>
</html>
`;

export function makeMockLatexmlConverter(): LatexmlConverter {
  return {
    convertToHtml(input: ConvertInput) {
      return ResultAsync.fromSafePromise(
        renderSourceHtml(input)
          .catch(() => TEMPLATE(input.filename))
          .then((html) => ({
            html: Buffer.from(html, 'utf8'),
            log: '[mock latexml source-html] OK',
          })),
      );
    },
  };
}

async function renderSourceHtml(input: ConvertInput): Promise<string> {
  const tex = await readTexSource(input);
  if (!/\\documentclass\b/.test(stripTexComments(tex))) {
    return TEMPLATE(input.filename);
  }
  return texToHtml(tex, input.filename);
}

async function readTexSource(input: ConvertInput): Promise<string> {
  if (/\.zip$/i.test(input.filename)) {
    return readFromArchive(input, 'src.zip', ['unzip', '-q', 'src.zip', '-d', '.']);
  }
  if (/\.(tar\.gz|tgz|tar)$/i.test(input.filename)) {
    const archive = /\.tar$/i.test(input.filename) ? 'src.tar' : 'src.tar.gz';
    return readFromArchive(input, archive, ['tar', '-xf', archive]);
  }
  return input.source.toString('utf8');
}

async function readFromArchive(
  input: ConvertInput,
  archiveName: string,
  command: string[],
): Promise<string> {
  const workdir = await mkdtemp(path.join(os.tmpdir(), 'openxiv-source-html-'));
  try {
    await writeFile(path.join(workdir, archiveName), input.source);
    await run(command[0]!, command.slice(1), workdir, 60_000);
    const entry = await findTexEntry(workdir);
    if (!entry) throw new Error('no tex entry found');
    return readFile(entry, 'utf8');
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

async function findTexEntry(root: string): Promise<string | null> {
  const candidates: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isFile() && /\.tex$/i.test(entry.name)) {
        candidates.push(abs);
      } else if (entry.isDirectory() && depth < 1) {
        await walk(abs, depth + 1);
      }
    }
  }
  await walk(root, 0);
  for (const candidate of candidates) {
    const content = await readFile(candidate, 'utf8').catch(() => '');
    if (/\\documentclass\b/.test(stripTexComments(content))) return candidate;
  }
  return candidates[0] ?? null;
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${cmd} timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stderr.on('data', (b: Buffer) => {
      stderr += b.toString('utf8');
      if (stderr.length > 4096) stderr = stderr.slice(-4096);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.trim()}`));
    });
  });
}

function texToHtml(tex: string, filename: string): string {
  const withoutComments = stripTexComments(tex);
  const title = cleanTexText(firstCommandArg(withoutComments, 'title') ?? titleFromFilename(filename));
  const author = cleanTexText(firstCommandArg(withoutComments, 'author') ?? '');
  const abstract = cleanTexText(environmentBody(withoutComments, 'abstract') ?? '');
  const body = bodyText(withoutComments);
  const blocks = renderBodyBlocks(body);

  const authorHtml = author ? `\n    <p class="ltx_authors">${escapeHtml(author)}</p>` : '';
  const abstractHtml = abstract
    ? `\n    <section class="ltx_abstract" id="abstract"><h2>Abstract</h2><p>${escapeHtml(
        abstract,
      )}</p></section>`
    : '';
  const bodyHtml = blocks.length > 0 ? blocks.join('\n    ') : '<p>The PDF is the authoritative rendering.</p>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
</head>
<body>
  <article>
    <h1>${escapeHtml(title)}</h1>${authorHtml}${abstractHtml}
    ${bodyHtml}
  </article>
</body>
</html>
`;
}

function bodyText(tex: string): string {
  const begin = tex.search(/\\begin\s*\{document\}/);
  const end = tex.search(/\\end\s*\{document\}/);
  const body = begin >= 0 ? tex.slice(begin).replace(/^.*?\\begin\s*\{document\}/s, '') : tex;
  const bounded = end >= 0 && end > begin ? body.slice(0, body.search(/\\end\s*\{document\}/)) : body;
  return bounded
    .replace(/\\maketitle\b/g, '')
    .replace(/\\begin\s*\{abstract\}[\s\S]*?\\end\s*\{abstract\}/g, '')
    .replace(/\\bibliographystyle\s*\{[^{}]*\}/g, '')
    .replace(/\\bibliography\s*\{[^{}]*\}/g, '');
}

function renderBodyBlocks(body: string): string[] {
  const marked = body
    .replace(/\\section\*?\s*\{([^{}]+)\}/g, '\n\n@@H2:$1\n\n')
    .replace(/\\subsection\*?\s*\{([^{}]+)\}/g, '\n\n@@H3:$1\n\n')
    .replace(/\\subsubsection\*?\s*\{([^{}]+)\}/g, '\n\n@@H4:$1\n\n');
  const blocks: string[] = [];
  for (const raw of marked.split(/\n\s*\n/g)) {
    const chunk = raw.trim();
    if (!chunk) continue;
    if (chunk.startsWith('@@H2:')) {
      blocks.push(`<h2>${escapeHtml(cleanTexText(chunk.slice(5)))}</h2>`);
      continue;
    }
    if (chunk.startsWith('@@H3:')) {
      blocks.push(`<h3>${escapeHtml(cleanTexText(chunk.slice(5)))}</h3>`);
      continue;
    }
    if (chunk.startsWith('@@H4:')) {
      blocks.push(`<h4>${escapeHtml(cleanTexText(chunk.slice(5)))}</h4>`);
      continue;
    }
    const text = cleanTexText(chunk);
    if (text) blocks.push(`<p>${escapeHtml(text)}</p>`);
  }
  return blocks;
}

function stripTexComments(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => {
      let out = '';
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]!;
        if (ch !== '%') {
          out += ch;
          continue;
        }
        let slashCount = 0;
        for (let j = out.length - 1; j >= 0 && out[j] === '\\'; j--) slashCount++;
        if (slashCount % 2 === 1) {
          out += ch;
          continue;
        }
        break;
      }
      return out;
    })
    .join('\n');
}

function firstCommandArg(content: string, command: string): string | undefined {
  const match = new RegExp(`\\\\${command}\\s*\\{`).exec(content);
  if (!match) return undefined;
  return readBalanced(content, match.index + match[0].length - 1);
}

function environmentBody(content: string, name: string): string | undefined {
  const match = new RegExp(`\\\\begin\\s*\\{${name}\\}([\\s\\S]*?)\\\\end\\s*\\{${name}\\}`).exec(
    content,
  );
  return match?.[1];
}

function readBalanced(content: string, openIndex: number): string | undefined {
  if (content[openIndex] !== '{') return undefined;
  let depth = 0;
  let out = '';
  for (let i = openIndex; i < content.length; i++) {
    const ch = content[i]!;
    const escaped = i > 0 && content[i - 1] === '\\';
    if (ch === '{' && !escaped) {
      if (depth > 0) out += ch;
      depth++;
      continue;
    }
    if (ch === '}' && !escaped) {
      depth--;
      if (depth === 0) return out;
      out += ch;
      continue;
    }
    if (depth > 0) out += ch;
  }
  return undefined;
}

function cleanTexText(input: string): string {
  let text = input
    .replace(/~+/g, ' ')
    .replace(/\\\\/g, '\n')
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\\\(|\\\)|\\\[|\\\]/g, '');
  for (let i = 0; i < 6; i++) {
    text = text.replace(
      /\\(?:textbf|textit|emph|texttt|mathrm|mathbf|mathit|underline)\*?(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g,
      '$1',
    );
  }
  return text
    .replace(/\\(?:label|ref|eqref|cite|citep|citet|url|href)\*?(?:\[[^\]]*\])?\s*\{[^{}]*\}/g, '')
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?(?:\{([^{}]*)\})?/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleFromFilename(filename: string): string {
  return path
    .basename(filename)
    .replace(/\.(tex|zip|tar\.gz|tgz|tar)$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
