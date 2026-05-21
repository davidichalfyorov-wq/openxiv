import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('private submissions surface', () => {
  it('links signed-in users to /me/submissions from the header', () => {
    const source = readFileSync(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8');

    expect(source).toContain('href="/me/submissions"');
    expect(source).toContain('Submissions');
  });

  it('shows the private submitted papers tab only from the owner profile branch', () => {
    const source = readFileSync(new URL('../src/pages/u/[handle].astro', import.meta.url), 'utf8');

    expect(source).toContain("['all', 'papers', 'posts', 'submissions']");
    expect(source).toContain('isOwner ? client.mySubmissions()');
    expect(source).toContain('<SubmissionRow submission={submission} />');
  });
});
