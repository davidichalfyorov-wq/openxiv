import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '@openxiv/shared';
import {
  editPaperRequestSchema,
  makePaperEditService,
} from '../services/paper-edit.js';

/**
 * Moderator paper-edit endpoints.
 *
 * `PATCH /api/admin/papers/:id` — apply an edit. Body: { reason, changes }.
 *   Reason is required + 8..500 chars. Changes is the diff-shape (only
 *   editable fields). Returns the new paper + audit rows + side-effect status.
 *
 * `GET /api/admin/papers/:id/edits` — audit history for the paper, newest
 *   first. Visible to admins only (the audit log can contain user-supplied
 *   reasons that may be sensitive).
 *
 * RBAC: both endpoints require the caller's session DID to be in
 * `ADMIN_DIDS`. Anyone else gets 403, not 404 — we don't hide the
 * endpoint's existence, just refuse access. The service layer also
 * re-validates so an internal caller can't accidentally bypass.
 */
export async function paperEditRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const service = makePaperEditService(ctx);

  function requireAdmin(req: { session?: { did: string } }): string {
    const did = req.session?.did;
    if (!did) throw Errors.unauthorized('sign in required');
    if (!ctx.env.ADMIN_DIDS.includes(did)) {
      throw Errors.forbidden(`${did} is not in ADMIN_DIDS`);
    }
    return did;
  }

  app.patch(
    '/admin/papers/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: editPaperRequestSchema,
      },
    },
    async (req) => {
      const did = requireAdmin(req);
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof editPaperRequestSchema>;
      const result = await service.edit({
        paperId: id,
        editorDid: did,
        request: body,
      });
      if (result.isErr()) throw result.error;
      const { paper, edits, sideEffects } = result.value;
      return {
        paper: {
          id: paper.id,
          title: paper.title,
          abstract: paper.abstract,
          primaryCategory: paper.primaryCategory,
          crossListings: paper.crossListings,
          license: paper.license,
          updatedAt: paper.updatedAt.toISOString(),
        },
        edits: edits.map(serializeEdit),
        sideEffects,
      };
    },
  );

  app.get(
    '/admin/papers/:id/edits',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      requireAdmin(req);
      const { id } = req.params as { id: string };
      const result = await ctx.repos.paperEdits.listForPaper(id, 100);
      if (result.isErr()) throw result.error;
      return { items: result.value.map(serializeEdit) };
    },
  );
}

function serializeEdit(e: {
  id: string;
  paperId: string;
  editorDid: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string;
  editedAt: Date;
}): Record<string, unknown> {
  return {
    id: e.id,
    field: e.field,
    editorDid: e.editorDid,
    oldValue: e.oldValue,
    newValue: e.newValue,
    reason: e.reason,
    editedAt: e.editedAt.toISOString(),
  };
}
