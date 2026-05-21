import { UnrecoverableError } from 'bullmq';
import type { AppContext } from '../context.js';
import { postStatus } from '../services/mastodon-crosspost.js';

export interface MastodonCrosspostJobData {
  readonly paperId: string;
}

export async function processMastodonCrosspostJob(
  ctx: AppContext,
  data: MastodonCrosspostJobData,
): Promise<{ status: 'posted' | 'skipped'; statusId?: string | null }> {
  const loadedResult = await ctx.repos.papers.loadWithRelations(data.paperId);
  if (loadedResult.isErr()) throw loadedResult.error;
  const loaded = loadedResult.value;
  if (!loaded) throw new UnrecoverableError(`not_found: paper ${data.paperId}`);
  const version = loaded.latestVersion;
  if (!version) throw new UnrecoverableError(`validation: paper ${data.paperId} has no version`);
  if (version.mastodonStatusId) return { status: 'posted', statusId: version.mastodonStatusId };

  const user = await findSubmitterUser(ctx, loaded.paper.submitterDid);
  if (!user) return skip(ctx, version.id, 'submitter user not found');
  const links = await ctx.repos.accountLinks.listForUser(user.id);
  if (links.isErr()) throw links.error;
  const mastodonLink = links.value.find((l) => l.provider === 'mastodon');
  if (!mastodonLink) return skip(ctx, version.id, 'no linked Mastodon account');
  if (!mastodonLink.mastodonAccessToken || !mastodonLink.mastodonInstanceUrl) {
    return skip(ctx, version.id, 'Mastodon token missing');
  }

  await ctx.repos.papers.setMastodonPostResult(version.id, { status: 'pending' }).match(
    () => undefined,
    (err) => {
      throw err;
    },
  );
  const posted = await postStatus(
    {
      instanceUrl: mastodonLink.mastodonInstanceUrl,
      accessToken: mastodonLink.mastodonAccessToken,
    },
    loaded.paper,
    ctx.env.PUBLIC_WEB_BASE,
  );
  if (posted.isErr()) {
    await ctx.repos.papers.setMastodonPostResult(version.id, {
      status: 'failed',
      error: posted.error.message,
    }).match(
      () => undefined,
      () => undefined,
    );
    throw posted.error;
  }
  await ctx.repos.papers.setMastodonPostResult(version.id, {
    status: 'posted',
    statusId: posted.value.id,
    statusUrl: posted.value.url,
  }).match(
    () => undefined,
    (err) => {
      throw err;
    },
  );
  return { status: 'posted', statusId: posted.value.id };
}

async function skip(ctx: AppContext, versionId: string, reason: string): Promise<{ status: 'skipped' }> {
  await ctx.repos.papers.setMastodonPostResult(versionId, { status: 'skipped', error: reason }).match(
    () => undefined,
    () => undefined,
  );
  return { status: 'skipped' };
}

async function findSubmitterUser(ctx: AppContext, did: string) {
  const primary = await ctx.repos.users.findByDid(did);
  if (primary.isErr()) throw primary.error;
  if (primary.value) return primary.value;
  const legacy = await ctx.repos.users.findByLegacyDid(did);
  if (legacy.isErr()) throw legacy.error;
  return legacy.value;
}
