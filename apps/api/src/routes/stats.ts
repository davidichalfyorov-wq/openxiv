import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  AiUseRow,
  CategoryRow,
  DisclosureOverviewRow,
  ModelRow,
  WeeklyRow,
} from '@openxiv/db';
import { Errors } from '@openxiv/shared';

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  app.get('/stats', async (_req, reply) => {
    const [overviewR, categoryR, aiUseR, modelR, weeklyR, detectorR, antiR] = await Promise.all([
      ctx.repos.stats.overview(),
      ctx.repos.stats.byCategory(),
      ctx.repos.stats.byAiUse(),
      ctx.repos.stats.byModel(),
      ctx.repos.stats.weekly(),
      ctx.repos.stats.detectorFlags(),
      ctx.repos.stats.antiVanity(),
    ]);
    if (overviewR.isErr()) throw overviewR.error;
    if (categoryR.isErr()) throw categoryR.error;
    if (aiUseR.isErr()) throw aiUseR.error;
    if (modelR.isErr()) throw modelR.error;
    if (weeklyR.isErr()) throw weeklyR.error;
    if (detectorR.isErr()) throw detectorR.error;
    if (antiR.isErr()) throw antiR.error;
    reply.header('cache-control', 'public, max-age=300');
    return {
      generatedAt: new Date().toISOString(),
      overview: overviewR.value,
      byCategory: categoryR.value,
      byAiUse: aiUseR.value,
      byModel: modelR.value,
      weekly: weeklyR.value,
      detector: detectorR.value,
      antiVanity: antiR.value,
    };
  });

  /**
   * CSV export, one cut per ?cut= parameter (overview|category|ai_use|model|weekly).
   * Defaults to category.
   */
  app.get(
    '/stats.csv',
    {
      schema: {
        querystring: z.object({
          cut: z.enum(['overview', 'category', 'ai_use', 'model', 'weekly']).default('category'),
        }),
      },
    },
    async (req, reply) => {
      const { cut } = req.query as { cut: 'overview' | 'category' | 'ai_use' | 'model' | 'weekly' };
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('cache-control', 'public, max-age=300');
      reply.header('content-disposition', `attachment; filename="openxiv-stats-${cut}.csv"`);

      switch (cut) {
        case 'overview': {
          const r = await ctx.repos.stats.overview();
          if (r.isErr()) throw r.error;
          const ov = r.value as DisclosureOverviewRow;
          const cols = Object.keys(ov);
          const vals = cols.map((c) => String((ov as unknown as Record<string, number>)[c]));
          return `${cols.join(',')}\n${vals.join(',')}\n`;
        }
        case 'category': {
          const r = await ctx.repos.stats.byCategory();
          if (r.isErr()) throw r.error;
          const rows = r.value as CategoryRow[];
          return `category,papers_total,level_none,level_assistant,level_coauthor,level_primary\n${rows
            .map(
              (x: CategoryRow) =>
                `${csvCell(x.category)},${x.papersTotal},${x.levelNone},${x.levelAssistant},${x.levelCoauthor},${x.levelPrimary}`,
            )
            .join('\n')}\n`;
        }
        case 'ai_use': {
          const r = await ctx.repos.stats.byAiUse();
          if (r.isErr()) throw r.error;
          const rows = r.value as AiUseRow[];
          return `ai_use,papers\n${rows
            .map((x: AiUseRow) => `${csvCell(x.aiUse)},${x.papers}`)
            .join('\n')}\n`;
        }
        case 'model': {
          const r = await ctx.repos.stats.byModel();
          if (r.isErr()) throw r.error;
          const rows = r.value as ModelRow[];
          return `model_name,model_vendor,papers\n${rows
            .map((x: ModelRow) => `${csvCell(x.modelName)},${csvCell(x.modelVendor ?? '')},${x.papers}`)
            .join('\n')}\n`;
        }
        case 'weekly': {
          const r = await ctx.repos.stats.weekly();
          if (r.isErr()) throw r.error;
          const rows = r.value as WeeklyRow[];
          return `week,papers_total,level_none,level_assistant,level_coauthor,level_primary\n${rows
            .map(
              (x: WeeklyRow) =>
                `${csvCell(x.week)},${x.papersTotal},${x.levelNone},${x.levelAssistant},${x.levelCoauthor},${x.levelPrimary}`,
            )
            .join('\n')}\n`;
        }
        default:
          throw Errors.validation(`unknown cut: ${cut}`);
      }
    },
  );

  /** Manual refresh — useful in dev. In prod a cron job calls this hourly. */
  app.post('/stats/refresh', async (_req, reply) => {
    const r = await ctx.repos.stats.refresh();
    if (r.isErr()) throw r.error;
    reply.status(202);
    return { ok: true, refreshedAt: new Date().toISOString() };
  });
}

function csvCell(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
