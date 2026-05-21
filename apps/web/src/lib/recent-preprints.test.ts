import { describe, expect, it, vi } from 'vitest';
import { loadRecentPreprints, RECENT_PREPRINT_LIMIT } from './recent-preprints.js';
import type { PaperSummary } from './api.js';

function paper(id: number): PaperSummary {
  return {
    id: `paper-${id}`,
    openxivId: `openxiv:cs.AI.2026.${String(id).padStart(5, '0')}`,
    openxivUrlId: `cs.AI.2026.${String(id).padStart(5, '0')}`,
    uri: null,
    title: `Paper ${id}`,
    primaryCategory: 'cs.AI',
    crossListings: [],
    status: 'published',
    createdAt: `2026-05-2${id}T12:00:00.000Z`,
    publishedAt: `2026-05-2${id}T12:00:00.000Z`,
    submitterDid: 'did:plc:author',
    authorNames: [`Author ${id}`],
    authorLine: `Author ${id}`,
  };
}

describe('loadRecentPreprints', () => {
  it('loads only the latest five preprints from the papers endpoint', async () => {
    const listPapers = vi.fn(async () => ({
      items: [1, 2, 3, 4, 5, 6, 7].map(paper),
    }));
    const feedHome = vi.fn();

    const result = await loadRecentPreprints({ listPapers, feedHome });

    expect(RECENT_PREPRINT_LIMIT).toBe(5);
    expect(listPapers).toHaveBeenCalledWith({ limit: 5 });
    expect(feedHome).not.toHaveBeenCalled();
    expect(result).toHaveLength(5);
    expect(result.map((item) => item.id)).toEqual(['paper-1', 'paper-2', 'paper-3', 'paper-4', 'paper-5']);
  });
});
