import type { AppContext } from '../context.js';

/**
 * Aggregate endorsement stats for the Social Review lane of Trust Passport.
 *
 * Failure mode: if the underlying query fails (e.g. column missing during a
 * partial deploy), we return zeros and the Social Review lane goes to
 * `pending` rather than 500ing the whole /papers/:id endpoint. This keeps
 * the abstract page resilient to incomplete migrations on staging clusters.
 */
export async function countEndorsementsForPaper(
  ctx: AppContext,
  paperId: string,
): Promise<{ endorsementCount: number; distinctEndorsementVerbs: number }> {
  const stats = await ctx.repos.endorsements.statsForPaper(paperId);
  if (stats.isOk()) {
    return {
      endorsementCount: stats.value.total,
      distinctEndorsementVerbs: stats.value.distinctVerbs,
    };
  }
  return { endorsementCount: 0, distinctEndorsementVerbs: 0 };
}
