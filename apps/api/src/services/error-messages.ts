import { AppError } from '@openxiv/shared';

/**
 * Canonical user-facing error catalogue for the submit pipeline.
 *
 * Every rejection (API response, saga state, UI surface) must look up
 * its code in `ERROR_MESSAGES` and emit the matching `UserMessage` to
 * the client. **The UI must never render a bare `error_code` string.**
 *
 * Codes are flat strings, not enums, so a future addition doesn't
 * require a coordinated client-side release — the server emits a new
 * code, the UI falls back to the generic `unknown_error` shape, and
 * the next client release picks up the dedicated message.
 *
 * Each `UserMessage` has three fields:
 *   - `title`     — one-line headline; renders in the alert header.
 *   - `body`      — full explanation; renders below the headline.
 *   - `fix_hint`  — actionable next step; renders as a footer / CTA.
 *
 * The shape ports to JSON cleanly — the same object reaches the
 * Astro page and the React island unchanged.
 */

export interface UserMessage {
  title: string;
  body: string;
  fix_hint: string;
}

export interface UserErrorPayload {
  error_code: SubmitErrorCode;
  user_message: UserMessage;
  /** Optional structured detail the UI may use (e.g. list of files). */
  details?: Record<string, unknown>;
}

export const SUBMIT_ERROR_CODES = [
  'no_documentclass',
  'multiple_documentclass',
  'companions_required',
  'size_limit',
  'malformed_archive',
  'tectonic_timeout',
  'tectonic_oom',
  'tectonic_failure',
  'latexml_failure',
  'extract_failure',
  'source_required',
  'unknown_error',
] as const;

export type SubmitErrorCode = (typeof SUBMIT_ERROR_CODES)[number];

/**
 * Catalogue keyed by error code. Texts are authored once here so the
 * server / saga / UI / docs all agree on phrasing.
 */
export const ERROR_MESSAGES: Record<SubmitErrorCode, UserMessage> = {
  no_documentclass: {
    title: "We couldn't find a LaTeX paper",
    body:
      'Your main .tex file must contain `\\documentclass{...}` — that line ' +
      'is what tells the compiler where the paper begins.',
    fix_hint:
      'Check that you included the main manuscript, not just supplementary ' +
      'material (figures, bib, supporting .tex chapters).',
  },
  multiple_documentclass: {
    title: 'Archive contains multiple manuscripts',
    body:
      'OpenXiv accepts one paper per submission. The archive has more than ' +
      'one .tex file that looks like a standalone manuscript — that means we ' +
      "can't pick which one to publish.",
    fix_hint:
      'Remove the extras or submit each manuscript separately. The list of ' +
      'detected entrypoints is below.',
  },
  companions_required: {
    title: 'Your .tex needs the supporting files',
    body:
      'Your single .tex references figures, a .bib, or other .tex chapters ' +
      "that weren't uploaded. The compiler can't fetch them on its own.",
    fix_hint:
      'Bundle the main .tex together with figures and the .bib file into a ' +
      '.zip or .tar.gz archive and re-submit. The missing files are listed ' +
      'below.',
  },
  size_limit: {
    title: 'Archive is too large',
    body: 'Submissions are capped at 100 MB. Yours is bigger than that.',
    fix_hint:
      'Compress figures (use vector/PDF where possible) or drop non-essential ' +
      'files (build artefacts, .aux/.log/.synctex.gz, dataset blobs).',
  },
  malformed_archive: {
    title: "Couldn't extract the archive",
    body:
      'The .zip or .tar.gz file failed to unpack — it may be corrupted, ' +
      'password-protected, or use a format we do not handle.',
    fix_hint:
      'Re-create the archive from the source folder. Use a plain .zip or ' +
      '.tar.gz with no nested wrapper directory required.',
  },
  tectonic_timeout: {
    title: 'Compilation took too long',
    body:
      'Tectonic ran for the maximum time we allow per submission and was ' +
      'cancelled. Common causes: heavy TikZ pictures, huge tables, ' +
      'pathological macros.',
    fix_hint:
      'Simplify or pre-render the heaviest figures (e.g. compile TikZ to a ' +
      'PDF and `\\includegraphics` it instead).',
  },
  tectonic_oom: {
    title: 'Compilation hit a resource limit',
    body:
      'Tectonic was killed by the worker resource guard before it could finish. ' +
      'This usually means the source needs more memory than the production ' +
      'compiler is allowed to use.',
    fix_hint:
      'Pre-render heavy TikZ/PGFPlots figures, reduce enormous tables, remove ' +
      'generated build artefacts, then re-submit the source archive.',
  },
  tectonic_failure: {
    title: 'LaTeX stopped on a source error',
    body:
      'The compiler found a LaTeX error in the uploaded source.',
    fix_hint:
      'Check the first LaTeX error in the log, fix that source problem, and ' +
      'upload the corrected archive again.',
  },
  latexml_failure: {
    title: 'HTML view not available',
    body:
      'Your paper compiled to a PDF successfully, but the LaTeXML pass that ' +
      "produces the in-browser reader view didn't finish. This is usually a " +
      'custom-package incompatibility, not a problem with the paper itself.',
    fix_hint:
      'The PDF is the canonical artefact — readers can still download and ' +
      'cite. The HTML reader at /abs/{id}/read will retry on the next version.',
  },
  extract_failure: {
    title: "Couldn't read the upload",
    body:
      "We received the file but couldn't parse it as a LaTeX source. This is " +
      'usually a mismatched extension (e.g. a binary saved with a .tex suffix) ' +
      'or an unsupported encoding.',
    fix_hint: 'Re-save as UTF-8 plain text and upload again.',
  },
  source_required: {
    title: 'LaTeX source required',
    body:
      'Upload your LaTeX source as a .tex file or a .tar.gz / .zip archive. ' +
      'PDF-only uploads are temporarily disabled.',
    fix_hint:
      'Bundle main.tex, your .bib, and figures into a .zip and submit. The ' +
      'compiler reads the source directly.',
  },
  unknown_error: {
    title: 'Something went wrong',
    body:
      "We couldn't classify the failure. The operator was notified and the " +
      'submission log is preserved.',
    fix_hint:
      'If this persists, mail davidich.alfyorov@gmail.com with the time of ' +
      'the upload and we will investigate.',
  },
};

/**
 * Helper that always returns a consistent `{error_code, user_message}`
 * pair. Use this everywhere a submit-pipeline rejection is emitted —
 * the route handler, the saga's terminal-failure path, the worker's
 * structured-log payload.
 */
export function makeUserError(
  error_code: SubmitErrorCode,
  details?: Record<string, unknown>,
): UserErrorPayload {
  const tpl = ERROR_MESSAGES[error_code] ?? ERROR_MESSAGES.unknown_error;
  // Avoid sharing the same object across responses — callers may
  // mutate `details` afterwards.
  const message: UserMessage = {
    title: tpl.title,
    body: tpl.body,
    fix_hint: tpl.fix_hint,
  };
  if (error_code === 'multiple_documentclass' && details) {
    addAmbiguousEntryDetails(message, details);
  }
  if (error_code === 'tectonic_failure' && details) {
    addTectonicFailureDetails(message, details);
  }
  return details
    ? { error_code, user_message: message, details }
    : { error_code, user_message: message };
}

export function makeSubmitUserError(err: unknown): UserErrorPayload {
  const code = classifySubmitError(err);
  const details = extractSubmitErrorDetails(err);
  return details ? makeUserError(code, details) : makeUserError(code);
}

function extractSubmitErrorDetails(err: unknown): Record<string, unknown> | undefined {
  if (!(err instanceof AppError)) return undefined;
  const causeMessage = err.cause?.message ?? '';
  if (!causeMessage) return undefined;
  return { compiler_log: causeMessage.slice(-8000) };
}

function addAmbiguousEntryDetails(
  message: UserMessage,
  details: Record<string, unknown>,
): void {
  const files = details['files'];
  if (!isNonEmptyStringArray(files)) return;

  message.title = 'We found more than one possible main .tex file';
  message.body =
    message.body +
    ` The ambiguous candidates are: ${formatFileList(files)}.`;
  message.fix_hint =
    'Keep only one standalone manuscript entry in the archive. Rename the real ' +
    'paper to main.tex, or remove the extra standalone .tex file(s) and submit ' +
    'them separately.';
}

function addTectonicFailureDetails(
  message: UserMessage,
  details: Record<string, unknown>,
): void {
  const compilerLog = readCompilerLog(details);
  if (!compilerLog) return;

  const explanation = explainTectonicLog(compilerLog);
  if (!explanation) return;

  message.title = explanation.title;
  message.body = explanation.body;
  message.fix_hint = explanation.fix_hint;
}

function readCompilerLog(details: Record<string, unknown>): string {
  const value = details['compiler_log'] ?? details['log'];
  return typeof value === 'string' ? value : '';
}

interface TectonicExplanation {
  readonly title: string;
  readonly body: string;
  readonly fix_hint: string;
}

function explainTectonicLog(log: string): TectonicExplanation | null {
  const missingFile = firstMatch(log, [
    /! LaTeX Error: File [`']([^`']+)['`] not found\./i,
    /File [`']([^`']+)['`] not found\./i,
    /I can'?t find file [`']?([^`'\s]+)['`]?/i,
  ]);
  if (missingFile) return explainMissingFile(missingFile);

  if (/Undefined control sequence\./i.test(log)) {
    const undefinedCommand =
      firstMatch(log, [/Undefined control sequence\.[\s\S]*?l\.\d+\s*(\\[A-Za-z@]+)/i]) ??
      '';
    return {
      title: 'A LaTeX command or macro is not defined',
      body: undefinedCommand
        ? `LaTeX stopped because it does not know the command \`${undefinedCommand}\`.`
        : 'LaTeX stopped because the source uses a command or macro that is not defined.',
      fix_hint:
        'Add the package or custom macro that defines it, or remove that command from the source, then upload the archive again.',
    };
  }

  const missingFont = explainMissingFontspecFont(log);
  if (missingFont) return missingFont;

  const latexError = firstMatch(log, [/! LaTeX Error:\s*([^\n\r]+)/i]);
  if (latexError) {
    return {
      title: 'LaTeX reported a source error',
      body: `LaTeX stopped at this error: ${latexError.trim()}`,
      fix_hint:
        'Fix the source line that caused this first LaTeX error, then upload the corrected archive again.',
    };
  }

  const packageError = firstMatch(log, [/! Package ([^:\n\r]+) Error:\s*([^\n\r]+)/i]);
  if (packageError) {
    return {
      title: 'A LaTeX package reported an error',
      body: `The LaTeX package error was: ${packageError.trim()}`,
      fix_hint:
        'Fix the package-specific problem shown in the log, then upload the corrected archive again.',
    };
  }

  if (/missing \\begin\{document\}/i.test(log)) {
    return {
      title: 'The main .tex file has no document body',
      body: 'LaTeX could not find `\\begin{document}` in the selected main file.',
      fix_hint:
        'Upload the real manuscript entry file, or add the missing document body to the selected main .tex file.',
    };
  }

  const excerpt = extractUsefulCompilerExcerpt(log);
  if (excerpt) {
    return {
      title: 'LaTeX stopped on a source error',
      body: `The compiler stopped at this error: ${excerpt}`,
      fix_hint:
        'Fix that first source error, then upload the corrected archive again. The later lines are often follow-on errors from the same problem.',
    };
  }

  return {
    title: 'LaTeX stopped before producing a PDF',
    body:
      'The compiler stopped before it could produce a PDF, but OpenXiv did not receive a detailed LaTeX error line.',
    fix_hint:
      'Check that the archive contains the real main .tex file and all files it references, then upload the corrected archive again.',
  };
}

function explainMissingFontspecFont(log: string): TectonicExplanation | null {
  const match = log.match(
    /(?:^|\n)(?:error:\s*)?(?:(?<location>[^:\n\r]+\.tex:\d+):\s*)?(?:! )?Package fontspec Error:\s*The font ["'`](?<font>[^"'`]+)["'`] cannot be found\./i,
  );
  const font = match?.groups?.['font']?.trim();
  if (!font) return null;

  const location = match?.groups?.['location']?.trim();
  const where = location ? ` at \`${location}\`` : '';

  return {
    title: 'A requested font is not installed',
    body:
      `LaTeX stopped${where} because the source asks for the system font ` +
      `\`${font}\`, but that font is not installed in the OpenXiv compiler environment.`,
    fix_hint:
      'Switch to a TeX Live font such as TeX Gyre Termes, bundle the font files and reference them explicitly, or remove the fontspec setting before uploading again.',
  };
}

function explainMissingFile(filename: string): TectonicExplanation {
  const lower = filename.toLowerCase();
  if (/\.(png|jpe?g|pdf|eps|svg)$/i.test(lower)) {
    return {
      title: 'A figure file is missing',
      body: `LaTeX stopped because the manuscript references \`${filename}\`, but that file was not found in the archive at the expected path.`,
      fix_hint:
        'Add the figure to the archive using that exact path, or update the `\\includegraphics` path in the .tex file.',
    };
  }

  if (/\.(bib|bst)$/i.test(lower)) {
    return {
      title: 'A bibliography file is missing',
      body: `LaTeX stopped because it could not find \`${filename}\`.`,
      fix_hint:
        'Include the bibliography file in the archive, or update the bibliography path in the .tex source.',
    };
  }

  if (/\.(sty|cls|clo)$/i.test(lower)) {
    return {
      title: 'A LaTeX package or class file is missing',
      body: `LaTeX stopped because it could not find \`${filename}\`.`,
      fix_hint:
        'Include that local package/class file in the archive, remove the dependency, or switch to a package available in the standard TeX environment.',
    };
  }

  return {
    title: 'A required LaTeX file is missing',
    body: `LaTeX stopped because it could not find \`${filename}\`.`,
    fix_hint:
      'Include the missing file in the archive at the referenced path, or update the .tex source so it points to the correct file.',
  };
}

function firstMatch(value: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) continue;
    return match[1]?.trim() ?? '';
  }
  return null;
}

function extractUsefulCompilerExcerpt(log: string): string {
  const lines = log
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates = [
    ...lines.filter((line) => /^error:/i.test(line)),
    ...lines.filter((line) => /^! /.test(line)),
    ...lines.filter((line) => /LaTeX Error|Package .* Error|Undefined control sequence/i.test(line)),
  ];

  const useful = candidates.find((line) => !isGenericCompilerLine(line));
  return useful ? truncateForUser(useful.replace(/^error:\s*/i, ''), 320) : '';
}

function isGenericCompilerLine(line: string): boolean {
  return /halted on potentially-recoverable error|running tex|rerun to get|transcript written/i.test(
    line,
  );
}

function truncateForUser(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.trim().length > 0)
  );
}

function formatFileList(files: string[]): string {
  const shown = files.slice(0, 5).map((file) => `\`${file}\``);
  const hiddenCount = files.length - shown.length;
  if (hiddenCount <= 0) return shown.join(', ');
  return `${shown.join(', ')} and ${hiddenCount} more`;
}

export function classifySubmitError(err: unknown): SubmitErrorCode {
  if (!(err instanceof AppError)) return 'unknown_error';
  if (err.kind !== 'compile_failure') return 'unknown_error';

  const causeMessage = err.cause?.message ?? '';
  const combined = `${err.message}\n${causeMessage}`.toLowerCase();

  if (combined.includes('tectonic timeout')) return 'tectonic_timeout';
  if (
    combined.includes('tectonic killed by resource limit') ||
    combined.includes('out of memory') ||
    combined.includes('oom') ||
    combined.includes('cannot allocate memory')
  ) {
    return 'tectonic_oom';
  }
  return 'tectonic_failure';
}
