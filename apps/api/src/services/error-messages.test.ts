import { AppError } from '@openxiv/shared';
import { describe, expect, it } from 'vitest';
import {
  classifySubmitError,
  ERROR_MESSAGES,
  makeSubmitUserError,
  makeUserError,
} from './error-messages.js';

describe('submit error messages', () => {
  it('has a user-facing message for Tectonic resource exhaustion', () => {
    expect(ERROR_MESSAGES.tectonic_oom.title).toMatch(/resource/i);
    expect(makeUserError('tectonic_oom').error_code).toBe('tectonic_oom');
  });

  it('maps Tectonic resource-limit compiler failures to tectonic_oom', () => {
    const err = new AppError('compile_failure', 'tectonic compile failed', {
      cause: new Error('tectonic killed by resource limit'),
    });

    expect(classifySubmitError(err)).toBe('tectonic_oom');
  });

  it('maps ordinary compiler failures to the generic Tectonic failure message', () => {
    const err = new AppError('compile_failure', 'tectonic compile failed', {
      cause: new Error('tectonic exited 1'),
    });

    expect(classifySubmitError(err)).toBe('tectonic_failure');
  });

  it('turns missing-file Tectonic logs into a specific user message', () => {
    const payload = makeUserError('tectonic_failure', {
      compiler_log: "error: main.tex:4: ! LaTeX Error: File `physics.sty' not found.",
    });

    expect(payload.user_message.title).toMatch(/missing/i);
    expect(payload.user_message.body).toContain('physics.sty');
    expect(payload.user_message.fix_hint).toMatch(/include|remove|package/i);
    expect(payload.user_message.fix_hint).not.toContain('tectonic -X compile');
  });

  it('turns undefined-control-sequence logs into a specific user message', () => {
    const payload = makeUserError('tectonic_failure', {
      compiler_log: '! Undefined control sequence.\nl.12 \\unknownmacro',
    });

    expect(payload.user_message.title).toMatch(/command|macro/i);
    expect(payload.user_message.body).toContain('\\unknownmacro');
    expect(payload.user_message.fix_hint).toMatch(/define|package/i);
  });

  it('still explains undefined-control-sequence logs when the command is not captured', () => {
    const payload = makeUserError('tectonic_failure', {
      compiler_log: '! Undefined control sequence.',
    });

    expect(payload.user_message.title).toMatch(/command|macro/i);
    expect(payload.user_message.fix_hint).toMatch(/define|package/i);
  });

  it('shows a useful compiler excerpt for unrecognized LaTeX failures', () => {
    const payload = makeUserError('tectonic_failure', {
      compiler_log:
        'note: Running TeX ...\nerror: manuscript.tex:42: Extra alignment tab has been changed to \\cr.\nerror: halted on potentially-recoverable error as specified',
    });

    expect(payload.user_message.title).toMatch(/source error/i);
    expect(payload.user_message.body).toContain('manuscript.tex:42');
    expect(payload.user_message.body).toContain('Extra alignment tab');
    expect(payload.user_message.body).not.toContain('not match one of the specific patterns');
  });

  it('explains missing fontspec system fonts in human-readable text', () => {
    const payload = makeUserError('tectonic_failure', {
      compiler_log:
        'error: main.tex:4: Package fontspec Error: The font "Times New Roman" cannot be found.',
    });

    expect(payload.user_message.title).toMatch(/font/i);
    expect(payload.user_message.body).toContain('Times New Roman');
    expect(payload.user_message.body).toContain('main.tex:4');
    expect(payload.user_message.body).not.toContain('Package fontspec Error');
    expect(payload.user_message.fix_hint).toMatch(/TeX Gyre Termes|bundle|remove/i);
  });

  it('builds submit user errors with compiler details from AppError causes', () => {
    const err = new AppError('compile_failure', 'tectonic compile failed', {
      cause: new Error("tectonic exited 1\n! LaTeX Error: File `refs.bib' not found."),
    });

    const payload = makeSubmitUserError(err);

    expect(payload.error_code).toBe('tectonic_failure');
    expect(payload.user_message.body).toContain('refs.bib');
    expect(payload.user_message.fix_hint).not.toContain('tectonic -X compile');
  });

  it('does not show the old local-reproduction instruction as the generic compile message', () => {
    const payload = makeUserError('tectonic_failure');

    expect(payload.user_message.body).not.toContain('Tectonic ran but exited');
    expect(payload.user_message.fix_hint).not.toContain('tectonic -X compile');
  });

  it('explains ambiguous manuscript entry names in human-readable text', () => {
    const payload = makeUserError('multiple_documentclass', {
      files: ['main.tex', 'supplement/main.tex'],
    });

    expect(payload.user_message.body).toContain('main.tex');
    expect(payload.user_message.body).toContain('supplement/main.tex');
    expect(payload.user_message.fix_hint).toMatch(/rename|remove/i);
  });
});
