import type { APIRoute } from 'astro';
import { serverClient } from '../../../../lib/api';

export const POST: APIRoute = async ({ params, request, redirect }) => {
  const id = params.id;
  if (!id) return new Response('Missing id', { status: 400 });

  const form = await request.formData();
  const disputeId = String(form.get('disputeId') ?? '').trim();
  const text = String(form.get('text') ?? '').trim();
  if (!disputeId || text.length < 20) {
    return redirect(`/abs/${id}/passport?response=invalid`, 303);
  }

  const cookie = request.headers.get('cookie') ?? undefined;
  const client = serverClient(cookie, request);
  try {
    await client.createPassportDisputeResponse(id, disputeId, { text });
    return redirect(`/abs/${id}/passport?response=created`, 303);
  } catch {
    return redirect(`/abs/${id}/passport?response=failed`, 303);
  }
};
