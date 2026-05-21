import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors, parseOpenxivId } from '@openxiv/shared';
import { VERSION_BECAUSE_OF_VALUES } from '@openxiv/db';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const changeFlagsSchema = z.object({
  claim: z.boolean().optional(),
  method: z.boolean().optional(),
  data: z.boolean().optional(),
  refs: z.boolean().optional(),
});

const becauseOfSchema = z.enum(VERSION_BECAUSE_OF_VALUES);

const changelogPatchSchema = z.object({
  changeFlags: changeFlagsSchema.nullable().optional(),
  becauseOf: becauseOfSchema.nullable().optional(),
  unresolved: z.string().max(1000).nullable().optional(),
  changelogNote: z.string().max(2000).nullable().optional(),
});

export async function versionsRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const services = app.services;

  /**
   * List all versions of a paper with their structured changelogs. Public.
   * Returns newest first so the changelog widget can render top-down.
   */
  app.get(
    '/papers/:id/versions',
    { schema: { params: z.object({ id: z.string() }) } },
    async (req) => {
      const { id } = req.params as { id: string };
      const paperRow = await resolvePaper(id);
      if (!paperRow) throw Errors.notFound('paper');
      const r = await ctx.repos.papers.allVersions(paperRow.id);
      if (r.isErr()) throw r.error;
      // Pre-compute a previous-version-id for each row so the UI can render
      // "compare with v(N-1)" without an extra round trip.
      const versions = r.value;
      const byVersion = new Map<number, string>();
      for (const v of versions) byVersion.set(v.versionNumber, v.id);
      return {
        items: versions.map((v) => ({
          id: v.id,
          versionNumber: v.versionNumber,
          createdAt: v.createdAt.toISOString(),
          publishedAt: v.publishedAt?.toISOString() ?? null,
          fileSha256: v.fileSha256,
          changelog:
            v.changeFlags || v.becauseOf || v.unresolved || v.changelogNote
              ? {
                  changeFlags: v.changeFlags ?? {},
                  becauseOf: v.becauseOf,
                  unresolved: v.unresolved,
                  note: v.changelogNote,
                  diffUrl: v.diffUrl,
                  previousVersionId: byVersion.get(v.versionNumber - 1) ?? null,
                }
              : null,
        })),
        becauseOfOptions: VERSION_BECAUSE_OF_VALUES,
      };
    },
  );

  /**
   * Set the structured changelog on a specific version. Only the submitter
   * or an admin can edit (a malicious third party should never reshape the
   * author's stated reason for revising).
   */
  app.patch(
    '/papers/:id/versions/:versionId/changelog',
    {
      preHandler: app.requireAuth,
      schema: {
        params: z.object({ id: z.string(), versionId: z.string().uuid() }),
        body: changelogPatchSchema,
      },
    },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      const { id, versionId } = req.params as { id: string; versionId: string };
      // Zod inference through fastify-type-provider-zod sometimes widens
      // optional+nullable fields. Re-parse here for a tight type.
      const body = changelogPatchSchema.parse(req.body);
      const paperRow = await resolvePaper(id);
      if (!paperRow) throw Errors.notFound('paper');
      if (paperRow.submitterDid !== req.session.did && !services.users.isAdminDid(req.session.did)) {
        throw Errors.forbidden('only submitter or admin can edit changelog');
      }
      const allVersions = await ctx.repos.papers.allVersions(paperRow.id);
      if (allVersions.isErr()) throw allVersions.error;
      const version = allVersions.value.find((v) => v.id === versionId);
      if (!version) throw Errors.notFound('version');
      const updated = await ctx.repos.papers.setVersionChangelog(versionId, {
        ...(body.changeFlags !== undefined ? { changeFlags: body.changeFlags ?? null } : {}),
        ...(body.becauseOf !== undefined ? { becauseOf: body.becauseOf ?? null } : {}),
        ...(body.unresolved !== undefined ? { unresolved: body.unresolved ?? null } : {}),
        ...(body.changelogNote !== undefined ? { changelogNote: body.changelogNote ?? null } : {}),
      });
      if (updated.isErr()) throw updated.error;
      return {
        id: updated.value.id,
        versionNumber: updated.value.versionNumber,
        changelog: {
          changeFlags: updated.value.changeFlags ?? {},
          becauseOf: updated.value.becauseOf,
          unresolved: updated.value.unresolved,
          note: updated.value.changelogNote,
          diffUrl: updated.value.diffUrl,
        },
      };
    },
  );

  async function resolvePaper(id: string): Promise<{ id: string; submitterDid: string } | null> {
    if (UUID_REGEX.test(id)) {
      const row = await ctx.repos.papers.findById(id);
      if (row.isErr()) throw row.error;
      return row.value;
    }
    const parsed = parseOpenxivId(id);
    if (!parsed) return null;
    const canonical = `openxiv:${parsed.subject}.${parsed.year}.${String(parsed.seq).padStart(5, '0')}`;
    const row = await ctx.repos.papers.findByOpenxivId(canonical);
    if (row.isErr()) throw row.error;
    return row.value;
  }
}
