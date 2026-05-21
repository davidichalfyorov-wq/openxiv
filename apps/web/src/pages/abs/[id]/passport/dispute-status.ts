import type { APIRoute } from 'astro';
import { serverClient } from '../../../../lib/api';

const STATUSES = new Set(['open', 'highlighted', 'resolved']);

export const POST: APIRoute = async ({ params, request, redirect }) => {
  const id = params.id;
  if (!id) return new Response('Missing id', { status: 400 });

  const form = await request.formData();
  const disputeId = String(form.get('disputeId') ?? '').trim();
  const status = String(form.get('status') ?? '').trim();
  if (!disputeId || !STATUSES.has(status)) {
    return redirect(`/abs/${id}/passport?status=invalid`, 303);
  }

  const cookie = request.headers.get('cookie') ?? undefined;
  const client = serverClient(cookie, request);
  try {
    await client.updatePassportDisputeStatus(id, disputeId, {
      status: status as 'open' | 'highlighted' | 'resolved',
    });
    return redirect(`/abs/${id}/passport?status=updated`, 303);
  } catch {
    return redirect(`/abs/${id}/passport?status=failed`, 303);
  }
};
