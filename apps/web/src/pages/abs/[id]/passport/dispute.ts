import type { APIRoute } from 'astro';
import { serverClient, type TrustPassportBundleCheck } from '../../../../lib/api';

const LANES = new Set([
  'transparency',
  'identity',
  'provenance',
  'citations',
  'math',
  'integrity',
  'socialReview',
]);

export const POST: APIRoute = async ({ params, request, redirect }) => {
  const id = params.id;
  if (!id) return new Response('Missing id', { status: 400 });

  const form = await request.formData();
  const lane = String(form.get('lane') ?? '');
  const text = String(form.get('text') ?? '').trim();
  const targetRef = String(form.get('targetRef') ?? '').trim();
  if (!LANES.has(lane) || text.length < 20) {
    return redirect(`/abs/${id}/passport?dispute=invalid`, 303);
  }

  const cookie = request.headers.get('cookie') ?? undefined;
  const client = serverClient(cookie, request);
  try {
    await client.createPassportDispute(id, {
      lane: lane as TrustPassportBundleCheck['lane'],
      text,
      ...(targetRef ? { targetRef } : {}),
    });
    return redirect(`/abs/${id}/passport?dispute=created`, 303);
  } catch {
    return redirect(`/abs/${id}/passport?dispute=failed`, 303);
  }
};
