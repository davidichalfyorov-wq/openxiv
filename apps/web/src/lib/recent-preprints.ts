import type { ApiClient, PaperSummary } from './api.js';

export const RECENT_PREPRINT_LIMIT = 5;

type RecentPreprintsClient = Pick<ApiClient, 'listPapers'> & Partial<Pick<ApiClient, 'feedHome'>>;

export async function loadRecentPreprints(
  client: RecentPreprintsClient,
): Promise<PaperSummary[]> {
  const { items } = await client.listPapers({ limit: RECENT_PREPRINT_LIMIT });
  return items.slice(0, RECENT_PREPRINT_LIMIT);
}
