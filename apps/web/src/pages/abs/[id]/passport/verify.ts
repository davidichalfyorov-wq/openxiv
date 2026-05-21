import type { APIRoute } from 'astro';
import { serverClient, type SignedTrustPassportBundle } from '../../../../lib/api';

export const POST: APIRoute = async ({ params, request, redirect }) => {
  const id = params.id;
  if (!id) return new Response('Missing id', { status: 400 });

  const form = await request.formData();
  const baselineDigest = String(form.get('baselineDigest') ?? '').trim();
  const baselinePassport = parseBaselinePassport(String(form.get('baselinePassport') ?? '').trim());
  const cookie = request.headers.get('cookie') ?? undefined;
  const client = serverClient(cookie, request);

  try {
    const result = await client.verifyPaperPassport(id, {
      ...(baselineDigest ? { baselineDigest } : {}),
      ...(baselinePassport ? { baselinePassport } : {}),
    });
    const verify =
      result.signatureValid && result.matchesBaseline !== false
        ? 'matched'
        : result.signatureValid
          ? 'changed'
          : 'failed';
    const qs = new URLSearchParams({
      verify,
      digest: result.semanticDigest,
      mode: result.comparison.mode,
    });
    if (result.comparison.mode === 'bundle') {
      qs.set(
        'baselineSignature',
        result.comparison.baselineSignatureValid ? 'valid' : 'invalid',
      );
      qs.set('changedLanes', result.comparison.changedLanes.map((lane) => lane.lane).join(','));
      qs.set('historyDelta', String(result.comparison.historyDelta));
      qs.set('publicDisputeDelta', String(result.comparison.publicDisputeDelta));
      qs.set('externalAttestationDelta', String(result.comparison.externalAttestationDelta));
    }
    return redirect(`/abs/${id}/passport?${qs.toString()}`, 303);
  } catch {
    return redirect(`/abs/${id}/passport?verify=failed`, 303);
  }
};

function parseBaselinePassport(raw: string): SignedTrustPassportBundle | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return undefined;
    if (parsed['type'] !== 'OpenXivTrustPassport') return undefined;
    if (typeof parsed['semanticDigest'] !== 'string') return undefined;
    if (typeof parsed['id'] !== 'string') return undefined;
    if (typeof parsed['paper_id'] !== 'string') return undefined;
    if (typeof parsed['signature'] !== 'string') return undefined;
    if (!Array.isArray(parsed['checks'])) return undefined;
    if (!Array.isArray(parsed['history'])) return undefined;
    if (!Array.isArray(parsed['publicDisputes'])) return undefined;
    if (!Array.isArray(parsed['externalAttestations'])) return undefined;
    if (!isRecord(parsed['proof'])) return undefined;
    return parsed as unknown as SignedTrustPassportBundle;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
