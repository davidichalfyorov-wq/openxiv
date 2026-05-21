import { expect, test } from '@playwright/test';

/**
 * Profile flow regression. Repro of the bug we fixed in Phase 5:
 *   - ORCID user signs in (mock provider — production OAuth needs real
 *     credentials we don't ship in CI).
 *   - Click their name in the header. Pre-fix this 404'd because of the
 *     three-encode pipeline (Base.astro + @[handle].astro + api.ts).
 *   - Land on /u/{handle}. The page renders avatar/displayName/modes etc.
 *   - Go to /settings/profile. Toggle Author public + save AI Usage Policy
 *     fields. Server stores it.
 *   - Reload the profile page. Author mode is now public and the AI Usage
 *     card is visible with the saved content.
 *
 * The test requires a running OpenXiv stack with USE_MOCK_CLIENTS=true (so
 * the mock OAuth callback at /auth/dev/mock-callback is enabled). Auto-skips
 * with a clear reason when the API or web is unreachable.
 */

test.describe('Profile flow (mock ORCID)', () => {
  test('sign in → click name → /u/{handle} → edit settings → see updates', async ({
    page,
    request,
    baseURL,
  }) => {
    // Skip when the stack isn't up — running the spec against /dev/null is
    // a noisy false negative, not a real failure.
    try {
      const health = await request.get('/api-proxy/healthz', { timeout: 3000 });
      test.skip(!health.ok(), `API /healthz returned ${health.status()}`);
    } catch (err) {
      test.skip(true, `API unreachable at ${baseURL}: ${(err as Error).message}`);
    }

    // 1. Sign in via mock ORCID. The dev mock provider returns a base64-
    //    encoded profile we control.
    await page.goto('/auth/sign-in');
    await page.getByRole('link', { name: /continue with orcid/i }).click();

    // After mock-callback the browser lands back on `/`. The Base.astro
    // header shows the user's displayName as a profile link.
    await expect(page).toHaveURL(/\//);
    const profileLink = page.locator('header').getByRole('link', {
      name: /mock orcid user/i,
    });
    await expect(profileLink).toBeVisible({ timeout: 10_000 });

    // 2. Click the profile link. Must not 404.
    //    Pre-fix the request that the SSR rendered would have been
    //    `/profiles/did%253Aweb%253Aopenxiv.local%253A...` and the page
    //    would have surfaced "Profile not available".
    const linkHref = await profileLink.getAttribute('href');
    expect(linkHref).toBeTruthy();
    expect(linkHref!).not.toContain('%25');
    await profileLink.click();
    await expect(page).toHaveURL(/\/u\//);
    await expect(page).not.toHaveURL(/%25/);
    await expect(page.getByRole('heading', { name: /mock orcid user/i })).toBeVisible({
      timeout: 10_000,
    });
    // Default mode = reader. Verify the pill is visible. The span has
    // surrounding whitespace + CSS text-transform:uppercase but getByText
    // matches against the underlying text content, so case-insensitive
    // substring matching is correct.
    await expect(
      page.locator('.profile-mode-pill', { hasText: /reader/i }),
    ).toBeVisible();

    // 3. Settings page. Mode toggles + AI Usage textareas + Reading Guide
    //    textareas must all render.
    await page.goto('/settings/profile');
    await expect(page.getByRole('heading', { name: /profile settings/i })).toBeVisible();
    await expect(page.locator('form[data-mode="author"]')).toBeVisible();
    await expect(page.locator('form[data-mode="reviewer"]')).toBeVisible();
    await expect(page.locator('form[data-mode="reader"]')).toBeVisible();
    // The five AI-policy textareas + four reading-guide textareas.
    for (const name of [
      'models_used',
      'models_avoided',
      'use_cases',
      'verification_practice',
      'failure_modes',
      'prerequisites',
      'start_here',
      'avoid_starting_with',
      'common_pitfalls',
    ]) {
      await expect(page.locator(`textarea[name="${name}"]`)).toBeVisible();
    }

    // 4. Enable Author mode (public) and save.
    const authorForm = page.locator('form[data-mode="author"]');
    await authorForm.locator('input[name="enabled"]').check();
    await authorForm.locator('input[name="public"]').check();
    await authorForm.getByRole('button', { name: /save/i }).click();
    await expect(authorForm.locator('[data-status]')).toHaveText(/saved/i, {
      timeout: 5000,
    });

    // 5. Fill AI Use Policy.
    await page.locator('textarea[name="models_used"]').fill('gpt-4o\nclaude-3-opus');
    await page.locator('textarea[name="verification_practice"]').fill(
      'Every AI-suggested derivation is hand-verified against the original sources.',
    );
    await page
      .locator('form[data-card="ai_policy"]')
      .getByRole('button', { name: /save ai policy/i })
      .click();
    await expect(
      page.locator('form[data-card="ai_policy"] [data-status]'),
    ).toHaveText(/saved/i, { timeout: 5000 });

    // 6. Reload /u/{handle}. The Author pill + AI Usage card must now
    //    surface, with the saved values.
    const profileUrlAfter = await profileLink.evaluate((el: HTMLAnchorElement) => el.href).catch(
      () => null,
    );
    // We may have navigated; refetch the link href from the live page.
    await page.goto('/');
    const reLink = page.locator('header').getByRole('link', {
      name: /mock orcid user/i,
    });
    await reLink.click();
    await expect(page).toHaveURL(/\/u\//);
    await expect(
      page.locator('.profile-mode-pill', { hasText: /author/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /ai usage policy/i })).toBeVisible();
    await expect(page.getByText(/gpt-4o/)).toBeVisible();
    await expect(page.getByText(/hand-verified against the original sources/i)).toBeVisible();
    void profileUrlAfter;
  });
});
