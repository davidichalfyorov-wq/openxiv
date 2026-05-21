import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('SubmissionWizard suggestion copy', () => {
  it('does not hard-code Gemini for the plain summary suggestion button', () => {
    const source = readFileSync(
      new URL('../src/components/SubmissionWizard.tsx', import.meta.url),
      'utf8',
    );

    expect(source).not.toContain('Suggest via Gemini');
    expect(source).not.toContain('Asking Gemini');
    expect(source).toContain('Suggest summary');
    expect(source).toContain('At least one plain-language summary tier is required');
    expect(source).toContain('optional, recommended');
  });
});
