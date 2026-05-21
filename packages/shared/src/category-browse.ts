import {
  CATEGORIES,
  CATEGORY_GROUPS,
  type CategoryGroup,
  type CategoryNode,
} from './categories.js';

export interface CategoryBrowseCategory {
  readonly code: string;
  readonly name: string;
  readonly group: CategoryGroup;
  readonly description: string | null;
  readonly paperCount: number;
  readonly href: string;
}

export interface CategoryBrowseGroup {
  readonly group: CategoryGroup;
  readonly paperCount: number;
  readonly categories: readonly CategoryBrowseCategory[];
}

export interface CategoryBrowse {
  readonly totalPublished: number;
  readonly popular: readonly CategoryBrowseCategory[];
  readonly groups: readonly CategoryBrowseGroup[];
}

export type CategoryCountMap = Readonly<Record<string, number>>;

/**
 * Optional inputs that let `buildCategoryBrowse` compute *distinct* paper
 * counts at the group and repository level. Without them we fall back to
 * summing per-category counts, which inflates the totals because a paper
 * cross-listed in (e.g.) `gr-qc` and `hep-th` is counted twice.
 *
 * The data source for `memberships` is the topics repository's
 * `categoryMemberships()` query: it returns deduplicated
 * `(paperId, code)` rows so callers can group them however they need.
 */
export interface CategoryBrowseOptions {
  readonly totalPublished?: number;
  readonly memberships?: ReadonlyArray<{ paperId: string; code: string }>;
}

const POPULAR_LIMIT = 12;

export function buildCategoryBrowse(
  counts: CategoryCountMap,
  options?: CategoryBrowseOptions,
): CategoryBrowse {
  const known = new Set(CATEGORIES.map((category) => category.code));
  const categoryRows = CATEGORIES.map((category) => toBrowseCategory(category, counts));
  const byGroup = new Map<CategoryGroup, CategoryBrowseCategory[]>();
  for (const group of CATEGORY_GROUPS) byGroup.set(group, []);
  for (const row of categoryRows) byGroup.get(row.group)?.push(row);

  // Distinct paper IDs per group, derived from the membership table.
  // When `memberships` is omitted, this stays empty and we fall back to the
  // (inflated) sum-of-category-counts below.
  const groupPaperIds = new Map<CategoryGroup, Set<string>>();
  if (options?.memberships) {
    const codeToGroup = new Map<string, CategoryGroup>();
    for (const category of CATEGORIES) {
      codeToGroup.set(category.code, category.group as CategoryGroup);
    }
    for (const m of options.memberships) {
      const group = codeToGroup.get(m.code);
      if (!group) continue;
      let bucket = groupPaperIds.get(group);
      if (!bucket) {
        bucket = new Set<string>();
        groupPaperIds.set(group, bucket);
      }
      bucket.add(m.paperId);
    }
  }

  const groups: CategoryBrowseGroup[] = CATEGORY_GROUPS.map((group) => {
    const categories = byGroup.get(group) ?? [];
    const distinctIds = groupPaperIds.get(group);
    const paperCount = distinctIds
      ? distinctIds.size
      : categories.reduce((sum, category) => sum + category.paperCount, 0);
    return {
      group,
      paperCount,
      categories,
    };
  });

  const popular = categoryRows
    .filter((category) => category.paperCount > 0)
    .sort((a, b) => b.paperCount - a.paperCount || a.code.localeCompare(b.code))
    .slice(0, POPULAR_LIMIT);

  // Top-line total: prefer the explicit value, then a distinct-id count
  // derived from memberships, and only as a last resort fall back to the
  // inflated per-category sum. That last fallback exists because some
  // tests construct browse objects from synthetic count maps.
  const totalPublished =
    options?.totalPublished ??
    (options?.memberships
      ? new Set(options.memberships.map((m) => m.paperId)).size
      : Object.entries(counts).reduce(
          (sum, [code, count]) => sum + (known.has(code) ? safeCount(count) : 0),
          0,
        ));

  return {
    totalPublished,
    popular,
    groups,
  };
}

function toBrowseCategory(
  category: CategoryNode,
  counts: CategoryCountMap,
): CategoryBrowseCategory {
  return {
    code: category.code,
    name: category.name,
    group: category.group as CategoryGroup,
    description: category.description ?? null,
    paperCount: safeCount(counts[category.code] ?? 0),
    href: `/topics/${encodeURIComponent(category.code)}`,
  };
}

function safeCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}
