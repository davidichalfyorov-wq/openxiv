import { expect, test } from '@playwright/test';

const SAMPLE_TEX = `\\documentclass{article}
\\title{Probing Synthetic Microbenchmarks for Preprint Pipelines}
\\author{A. Author}
\\begin{document}
\\maketitle
\\begin{abstract}
We exercise the OpenXiv submission pipeline end-to-end via a minimal LaTeX
document with enough sentences to give downstream metadata extractors and
heuristic detectors meaningful surface area.
\\end{abstract}
\\section{Introduction}
This file is exercised by Playwright; the compiler is mocked, but the
orchestration that uploads the source, runs the worker, generates a
version row, and surfaces a publishable paper is real.
\\end{document}`;

test.describe('OpenXiv happy path', () => {
  test('sign in → submit → publish → see in feed', async ({ page, request }) => {
    // 1. Sign in via mock ORCID
    await page.goto('/auth/sign-in');
    await page.getByRole('link', { name: /continue with orcid/i }).click();
    test.skip(/orcid\.org/i.test(page.url()), 'mock ORCID is not configured for this stack');
    await expect(page).toHaveURL(/\//);
    await expect(page.getByRole('link', { name: /a\. author/i })).toBeVisible({ timeout: 10_000 });

    // 2. Open submit wizard
    await page.goto('/submit');
    await expect(page.getByRole('heading', { name: /submit a paper/i })).toBeVisible();

    // Step 0: title + abstract
    await page.getByLabel(/title/i).fill('Probing Synthetic Microbenchmarks for Preprint Pipelines');
    await page.getByLabel(/abstract/i).fill('A minimal end-to-end exerciser for the OpenXiv submission pipeline.');
    await page.getByRole('button', { name: /^next$/i }).click();

    // Step 1: categories + authors
    await page.getByLabel(/authors/i).fill('A. Author | OpenXiv Test U');
    await page.getByRole('button', { name: /^next$/i }).click();

    // Step 2: source file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'main.tex',
      mimeType: 'application/x-tex',
      buffer: Buffer.from(SAMPLE_TEX, 'utf8'),
    });
    await page.getByRole('button', { name: /^next$/i }).click();

    // Step 3: disclosure (default 'none' is fine for happy path)
    await page.getByRole('button', { name: /^next$/i }).click();

    // Step 4: summary
    await page.getByLabel(/plain-language summary/i).fill(
      'This paper exercises the OpenXiv submission pipeline. It uploads a tiny LaTeX source, the mock compiler produces a stub PDF, and the resulting paper becomes visible on the home feed. We use the test as a smoke check for the full integration path including authentication, multipart upload, BullMQ queueing, and AT-proto-shaped record publishing.',
    );
    await page.getByRole('button', { name: /submit draft/i }).click();

    // 3. Submitted — link to paper appears
    const openLink = page.getByRole('link', { name: /open paper/i });
    await expect(openLink).toBeVisible({ timeout: 20_000 });
    const paperHref = await openLink.getAttribute('href');
    expect(paperHref).toMatch(/^\/paper\/[0-9a-f-]{36}$/);
    const paperId = paperHref!.split('/').pop()!;

    // 4. Wait for status to leave "compiling" — worker should pick up the job
    let attempts = 0;
    let status = 'compiling';
    while (status === 'compiling' && attempts < 30) {
      const res = await request.get(`/api-proxy/papers/${paperId}`);
      if (res.ok()) {
        const json = (await res.json()) as { status: string };
        status = json.status;
      }
      if (status !== 'compiling') break;
      attempts += 1;
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect(status).not.toBe('compiling');
    expect(status).not.toBe('compile_failed');

    // 5. Open paper page and publish
    await page.goto(paperHref!);
    await expect(page.getByRole('heading', { name: /probing synthetic microbenchmarks/i })).toBeVisible();
    const publishBtn = page.getByRole('button', { name: /publish to at-proto/i });
    await expect(publishBtn).toBeEnabled({ timeout: 10_000 });
    await publishBtn.click();
    await expect(page.getByText(/published/i)).toBeVisible({ timeout: 10_000 });

    // 6. Home feed shows the published paper
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /probing synthetic microbenchmarks/i })).toBeVisible({
      timeout: 10_000,
    });
  });
});
