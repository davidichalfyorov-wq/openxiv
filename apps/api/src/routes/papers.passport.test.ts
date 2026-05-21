import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { ResultAsync } from '@openxiv/shared';
import { hashes, sign } from '@noble/secp256k1';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { AppContext } from '../context.js';
import type { SessionPayload } from '../auth/session.js';
import { generateKeypair } from '../services/user-keys.js';
import {
  canonicalJson,
  externalAttestationSigningPayload,
  verifyTrustPassportBundle,
} from '../services/trust-passport-bundle.js';
import { papersRoutes } from './papers.js';

const okAsync = <T>(value: T) => ResultAsync.fromSafePromise(Promise.resolve(value));
const utf8 = (value: string) => new TextEncoder().encode(value);

describe('papersRoutes Trust Passport artifact', () => {
  it('serves a signed JSON-LD passport without a single aggregate score', async () => {
    const prevKey = process.env['OPENXIV_SERVICE_PRIVATE_KEY_BASE64'];
    const keypair = generateKeypair();
    const app = Fastify();
    try {
      process.env['OPENXIV_SERVICE_PRIVATE_KEY_BASE64'] = Buffer.from(keypair.privateKey).toString(
        'base64',
      );
      app.setValidatorCompiler(validatorCompiler);
      app.setSerializerCompiler(serializerCompiler);
      app.decorate('ctx', passportContext());
      await app.register(papersRoutes);

      const res = await app.inject({
        method: 'GET',
        url: '/papers/gr-qc.2026.00001/passport',
      });

      expect(res.statusCode, res.body).toBe(200);
      expect(res.headers['content-type']).toContain('application/ld+json');
      const body = res.json();
      expect(body.paper_id).toBe('openxiv:gr-qc.2026.00001');
      expect(body.checks.map((check: { lane: string }) => check.lane)).toEqual([
        'transparency',
        'identity',
        'provenance',
        'citations',
        'math',
        'integrity',
        'socialReview',
      ]);
      const citations = body.checks.find((check: { lane: string }) => check.lane === 'citations');
      expect(citations).toMatchObject({
        status: 'yellow',
        issueLevel: 'needs-work',
        checker: 'openxiv-citations-v1.0',
        summary: expect.objectContaining({
          unresolvedDisputeCount: 1,
          responseCount: 1,
          historyState: 'answered_contestation',
          topAction: 'Respond to or resolve 1 open citations dispute.',
        }),
        nextActions: expect.arrayContaining([
          'Respond to or resolve 1 open citations dispute.',
        ]),
      });
      expect(citations.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: 'Citation [3]',
            ref: '[3]',
            resolved: 'arXiv:2601.00001',
            via: 'arxiv',
            confidence: 'high',
            status: 'pass',
          }),
          expect.objectContaining({
            label: 'Citation [7]',
            ref: '[7]',
            resolved: null,
            reason: 'No DOI, arXiv, or stable URL found in reference entry.',
            status: 'fail',
          }),
        ]),
      );
      expect(citations.items[0]).toEqual(
        expect.objectContaining({
          weight: expect.any(Number),
          severity: expect.any(String),
          source: 'pipeline',
        }),
      );
      const math = body.checks.find((check: { lane: string }) => check.lane === 'math');
      expect(math).toMatchObject({
        status: 'green',
        checker: 'openxiv-math-v1.0',
      });
      expect(math.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: 'Formula evidence 1',
            category: 'formula',
            section: 'Proof of the main result',
            snippet: expect.stringContaining('K = 96 M^2 / l^6'),
            confidence: 'medium',
            status: 'pass',
          }),
          expect.objectContaining({
            label: 'Formal structure 1',
            category: 'formal_statement',
            section: 'Proof of the main result',
            snippet: expect.stringContaining('Theorem 1.'),
            confidence: 'high',
            status: 'pass',
          }),
          expect.objectContaining({
            label: 'Source archive for math audit',
            category: 'source_archive',
            status: 'pass',
          }),
          expect.objectContaining({
            label: 'Human math verification',
            category: 'human_attestation',
            status: 'pass',
          }),
        ]),
      );
      expect(body.semanticDigest).toMatch(/^sha256-[A-Za-z0-9_-]+$/);
      expect(body.checks[0]).toEqual(
        expect.objectContaining({
          issueLevel: expect.any(String),
          nextActions: expect.any(Array),
          summary: expect.objectContaining({
            passedItems: expect.any(Number),
            attentionItems: expect.any(Number),
            pendingItems: expect.any(Number),
          }),
        }),
      );
      expect(body.checks.every((check: Record<string, unknown>) => !('score' in check))).toBe(true);
      expect(body.checks.every((check: Record<string, unknown>) => !('confidence' in check))).toBe(
        true,
      );
      expect(body.checks[0].items[0]).toEqual(
        expect.objectContaining({
          status: expect.any(String),
          weight: expect.any(Number),
          severity: expect.any(String),
          source: expect.any(String),
        }),
      );
      expect(body.publicDisputes).toEqual([
        expect.objectContaining({
          id: 'post-dispute',
          targetRef: 'section 2.1',
          status: 'open',
          lane: 'citations',
        }),
      ]);
      expect(body.publicDisputeResponses).toEqual([
        expect.objectContaining({
          id: 'post-dispute-response',
          disputeId: 'post-dispute',
          lane: 'citations',
          authorDid: 'did:plc:author',
          text: 'Thanks, this will be clarified in the next version.',
        }),
      ]);
      expect(body.externalAttestations).toEqual([
        expect.objectContaining({
          id: 'post-attestation',
          issuer: 'did:web:biorxiv.org',
          publicKeyMultibase: expect.any(String),
          lane: 'integrity',
          statement: 'We independently verified the dataset integrity lane.',
          signature: expect.any(String),
          signatureVerified: true,
        }),
      ]);
      expect(body.history.map((event: { type: string }) => event.type)).toEqual([
        'public_dispute',
        'dispute_response',
        'external_attestation',
      ]);
      expect(body.history).toEqual([
        expect.objectContaining({
          id: 'post-dispute',
          type: 'public_dispute',
          lane: 'citations',
          actorDid: 'did:plc:reader',
          targetRef: 'section 2.1',
        }),
        expect.objectContaining({
          id: 'post-dispute-response',
          type: 'dispute_response',
          lane: 'citations',
          actorDid: 'did:plc:author',
          relatedId: 'post-dispute',
        }),
        expect.objectContaining({
          id: 'post-attestation',
          type: 'external_attestation',
          lane: 'integrity',
          actorDid: 'did:web:biorxiv.org',
          signature: expect.any(String),
          signatureVerified: true,
        }),
      ]);
      expect(JSON.stringify(body.publicDisputes)).not.toContain('post-general');
      expect(JSON.stringify(body)).not.toMatch(
        /trustScore|transparencyScore|aggregateScore|"score"|"confidence":\d/i,
      );
      expect(verifyTrustPassportBundle(body, keypair.publicKey)).toBe(true);
    } finally {
      await app.close();
      if (prevKey === undefined) delete process.env['OPENXIV_SERVICE_PRIVATE_KEY_BASE64'];
      else process.env['OPENXIV_SERVICE_PRIVATE_KEY_BASE64'] = prevKey;
    }
  });

  it('reruns passport checks and compares them with the displayed semantic digest', async () => {
    const prevKey = process.env['OPENXIV_SERVICE_PRIVATE_KEY_BASE64'];
    const keypair = generateKeypair();
    const app = Fastify();
    try {
      process.env['OPENXIV_SERVICE_PRIVATE_KEY_BASE64'] = Buffer.from(keypair.privateKey).toString(
        'base64',
      );
      app.setValidatorCompiler(validatorCompiler);
      app.setSerializerCompiler(serializerCompiler);
      app.decorate('ctx', passportContext());
      await app.register(papersRoutes);

      const first = await app.inject({
        method: 'GET',
        url: '/papers/gr-qc.2026.00001/passport',
      });
      expect(first.statusCode, first.body).toBe(200);
      const displayed = first.json();

      const rerun = await app.inject({
        method: 'POST',
        url: '/papers/gr-qc.2026.00001/passport/verify',
        payload: { baselineDigest: displayed.semanticDigest },
      });

      expect(rerun.statusCode, rerun.body).toBe(200);
      expect(rerun.json()).toMatchObject({
        ok: true,
        signatureValid: true,
        matchesBaseline: true,
        semanticDigest: displayed.semanticDigest,
        lanes: [
          expect.objectContaining({ lane: 'transparency' }),
          expect.objectContaining({ lane: 'identity' }),
          expect.objectContaining({ lane: 'provenance' }),
          expect.objectContaining({ lane: 'citations' }),
          expect.objectContaining({ lane: 'math' }),
          expect.objectContaining({ lane: 'integrity' }),
          expect.objectContaining({ lane: 'socialReview' }),
        ],
      });
      const citationLane = rerun
        .json()
        .lanes.find((lane: { lane: string }) => lane.lane === 'citations');
      expect(citationLane).toEqual(
        expect.objectContaining({
          lane: 'citations',
          status: expect.any(String),
          issueLevel: expect.any(String),
          summary: expect.objectContaining({
            passedItems: expect.any(Number),
            attentionItems: expect.any(Number),
            pendingItems: expect.any(Number),
            externalAttestationCount: expect.any(Number),
          }),
        }),
      );
      expect(citationLane).not.toHaveProperty('score');
      expect(citationLane).not.toHaveProperty('confidence');
      expect(rerun.json().passport.signature).toMatch(/^[A-Za-z0-9_-]+$/);
    } finally {
      await app.close();
      if (prevKey === undefined) delete process.env['OPENXIV_SERVICE_PRIVATE_KEY_BASE64'];
      else process.env['OPENXIV_SERVICE_PRIVATE_KEY_BASE64'] = prevKey;
    }
  });

  it('reports lane and history changes when rerun differs from the displayed passport', async () => {
    const prevKey = process.env['OPENXIV_SERVICE_PRIVATE_KEY_BASE64'];
    const keypair = generateKeypair();
    let includeNewDispute = false;
    const disputePost = (id: string, targetRef: string, createdAt: string) => ({
      id,
      uri: `at://did:plc:reader/app.openxiv.post/${id}`,
      cid: null,
      authorDid: 'did:plc:reader',
      text: `Citation evidence changed for ${targetRef}; please check this lane.`,
      replyRootUri: null,
      replyParentUri: null,
      embedPaperUri: 'at://did:plc:author/app.openxiv.paper/abc',
      embedExternal: null,
      tags: ['trust-dispute', 'trust-lane:citations', `trust-target:${targetRef}`],
      langs: null,
      pinnedByAuthor: false,
      label: null,
      hiddenByMod: false,
      createdAt: new Date(createdAt),
    });
    const forPaperUri = vi.fn(() =>
      okAsync([
        disputePost('post-dispute-original', 'section 2.1', '2026-05-19T12:05:00.000Z'),
        ...(includeNewDispute
          ? [disputePost('post-dispute-new', 'reference [7]', '2026-05-19T12:10:00.000Z')]
          : []),
      ]),
    );
    const app = Fastify();
    try {
      process.env['OPENXIV_SERVICE_PRIVATE_KEY_BASE64'] = Buffer.from(keypair.privateKey).toString(
        'base64',
      );
      app.setValidatorCompiler(validatorCompiler);
      app.setSerializerCompiler(serializerCompiler);
      app.decorate('ctx', passportContext({ forPaperUri }));
      await app.register(papersRoutes);

      const first = await app.inject({
        method: 'GET',
        url: '/papers/gr-qc.2026.00001/passport',
      });
      expect(first.statusCode, first.body).toBe(200);
      const displayed = first.json();
      includeNewDispute = true;

      const rerun = await app.inject({
        method: 'POST',
        url: '/papers/gr-qc.2026.00001/passport/verify',
        payload: {
          baselineDigest: displayed.semanticDigest,
          baselinePassport: displayed,
        },
      });

      expect(rerun.statusCode, rerun.body).toBe(200);
      expect(rerun.json()).toMatchObject({
        ok: true,
        signatureValid: true,
        matchesBaseline: false,
        comparison: {
          mode: 'bundle',
          changed: true,
          baselineSignatureValid: true,
          baselineDigest: displayed.semanticDigest,
          currentDigest: expect.any(String),
          historyDelta: 1,
          publicDisputeDelta: 1,
          externalAttestationDelta: 0,
          changedLanes: [
            expect.objectContaining({
              lane: 'citations',
              baselineSummary: expect.objectContaining({ disputeCount: 1 }),
              currentSummary: expect.objectContaining({ disputeCount: 2 }),
            }),
          ],
        },
      });
      expect(rerun.json().comparison.currentDigest).not.toBe(displayed.semanticDigest);
    } finally {
      await app.close();
      if (prevKey === undefined) delete process.env['OPENXIV_SERVICE_PRIVATE_KEY_BASE64'];
      else process.env['OPENXIV_SERVICE_PRIVATE_KEY_BASE64'] = prevKey;
    }
  });

  it('extracts citation evidence from TeX bibliography keys, ranges, and wrapped reference entries', async () => {
    const prevKey = process.env['OPENXIV_SERVICE_PRIVATE_KEY_BASE64'];
    const keypair = generateKeypair();
    const app = Fastify();
    try {
      process.env['OPENXIV_SERVICE_PRIVATE_KEY_BASE64'] = Buffer.from(keypair.privateKey).toString(
        'base64',
      );
      app.setValidatorCompiler(validatorCompiler);
      app.setSerializerCompiler(serializerCompiler);
      app.decorate(
        'ctx',
        passportContext({
          sections: [
            {
              id: 'section-tex-body',
              paperId: 'paper-uuid',
              sectionIdx: 0,
              title: 'Continuum argument',
              anchor: 'continuum-argument',
              content:
                'The proof follows \\cite{penrose1965,old-arxiv}. The numerical comparison uses [2-3].',
              embedding: [],
              model: 'test',
              createdAt: new Date('2026-05-19T12:02:00.000Z'),
            },
            {
              id: 'section-tex-refs',
              paperId: 'paper-uuid',
              sectionIdx: 1,
              title: 'Bibliography',
              anchor: 'bibliography',
              content:
                '\\bibitem{penrose1965}\nR. Penrose. Gravitational collapse and space-time singularities.\nhttps://doi.org/10.1103/PhysRevLett.14.57\n\\bibitem{old-arxiv} R. Wald. Black hole mechanics. arXiv:gr-qc/9305022\n2. Dataset release and reproducibility archive.\nhttps://example.org/openxiv/dataset\n[3] Local monograph without a persistent identifier.',
              embedding: [],
              model: 'test',
              createdAt: new Date('2026-05-19T12:02:00.000Z'),
            },
          ],
        }),
      );
      await app.register(papersRoutes);

      const res = await app.inject({
        method: 'GET',
        url: '/papers/gr-qc.2026.00001/passport',
      });

      expect(res.statusCode, res.body).toBe(200);
      const citations = res
        .json()
        .checks.find((check: { lane: string }) => check.lane === 'citations');
      expect(citations.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: 'Citation {penrose1965}',
            ref: '{penrose1965}',
            resolved: '10.1103/PhysRevLett.14.57',
            via: 'doi',
            confidence: 'high',
            status: 'pass',
          }),
          expect.objectContaining({
            label: 'Citation {old-arxiv}',
            ref: '{old-arxiv}',
            resolved: 'arXiv:gr-qc/9305022',
            via: 'arxiv',
            confidence: 'high',
            status: 'pass',
          }),
          expect.objectContaining({
            label: 'Citation [2]',
            ref: '[2]',
            resolved: 'https://example.org/openxiv/dataset',
            via: 'url',
            confidence: 'medium',
            status: 'pass',
          }),
          expect.objectContaining({
            label: 'Citation [3]',
            ref: '[3]',
            resolved: null,
            reason: 'No DOI, arXiv, or stable URL found in reference entry.',
            status: 'fail',
          }),
        ]),
      );
    } finally {
      await app.close();
      if (prevKey === undefined) delete process.env['OPENXIV_SERVICE_PRIVATE_KEY_BASE64'];
      else process.env['OPENXIV_SERVICE_PRIVATE_KEY_BASE64'] = prevKey;
    }
  });

  it('falls back to retained source citation evidence when indexed text lost the bibliography', async () => {
    const prevKey = process.env['OPENXIV_SERVICE_PRIVATE_KEY_BASE64'];
    const keypair = generateKeypair();
    const app = Fastify();
    const storageGet = vi.fn((key: string) =>
      okAsync({
        key,
        contentType: 'text/x-tex',
        body: Buffer.from(
          [
            '\\documentclass{article}',
            '\\begin{document}',
            'The bound follows \\cite{Chamseddine:1996zu,Connes:2006qj}.',
            '\\begin{thebibliography}{9}',
            '\\bibitem{Chamseddine:1996zu} A. Chamseddine and A. Connes. doi:10.1007/BF02096950',
            '\\bibitem{Connes:2006qj} A. Connes. arXiv:hep-th/0608226',
            '\\end{thebibliography}',
            '\\end{document}',
          ].join('\n'),
          'utf8',
        ),
      }),
    );
    try {
      process.env['OPENXIV_SERVICE_PRIVATE_KEY_BASE64'] = Buffer.from(keypair.privateKey).toString(
        'base64',
      );
      app.setValidatorCompiler(validatorCompiler);
      app.setSerializerCompiler(serializerCompiler);
      app.decorate(
        'ctx',
        passportContext({
          loaded: loadedPaper({ sourceKey: 'source-main.tex' }),
          storageGet,
          sections: [
            {
              id: 'section-indexed-body',
              paperId: 'paper-uuid',
              sectionIdx: 0,
              title: 'Continuum argument',
              anchor: 'continuum-argument',
              content:
                'The rendered text still has citation keys [Chamseddine:1996zu, Connes:2006qj], but no indexed References block.',
              embedding: [],
              model: 'test',
              createdAt: new Date('2026-05-19T12:02:00.000Z'),
            },
          ],
        }),
      );
      await app.register(papersRoutes);

      const res = await app.inject({
        method: 'GET',
        url: '/papers/gr-qc.2026.00001/passport',
      });

      expect(res.statusCode, res.body).toBe(200);
      expect(storageGet).toHaveBeenCalledWith('source-main.tex');
      const citations = res
        .json()
        .checks.find((check: { lane: string }) => check.lane === 'citations');
      expect(citations.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: 'Citation {Chamseddine:1996zu}',
            resolved: '10.1007/BF02096950',
            status: 'pass',
          }),
          expect.objectContaining({
            label: 'Citation {Connes:2006qj}',
            resolved: 'arXiv:hep-th/0608226',
            status: 'pass',
          }),
        ]),
      );
    } finally {
      await app.close();
      if (prevKey === undefined) delete process.env['OPENXIV_SERVICE_PRIVATE_KEY_BASE64'];
      else process.env['OPENXIV_SERVICE_PRIVATE_KEY_BASE64'] = prevKey;
    }
  });

  it('stores a lane-specific public dispute as a tagged paper post', async () => {
    const create = vi.fn(() =>
      okAsync({
        id: 'created-dispute',
        uri: 'at://did:plc:reader/app.openxiv.post/new',
        cid: null,
        authorDid: 'did:plc:reader',
        text: 'Citation [3] does not support the stated claim in section 2.1.',
        replyRootUri: null,
        replyParentUri: null,
        embedPaperUri: 'at://did:plc:author/app.openxiv.paper/abc',
        embedExternal: null,
        tags: ['trust-dispute', 'trust-lane:citations', 'trust-target:section 2.1'],
        langs: null,
        pinnedByAuthor: false,
        label: null,
        hiddenByMod: false,
        createdAt: new Date('2026-05-19T12:07:00.000Z'),
      }),
    );
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('ctx', passportContext({ create }));
    app.decorate('requireAuth', async (req: unknown) => {
      (req as { session?: SessionPayload }).session = {
        uid: 'reader-1',
        did: 'did:plc:reader',
        role: 'author',
        exp: Math.floor(Date.now() / 1000) + 60,
      };
    });
    await app.register(papersRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/papers/gr-qc.2026.00001/passport/disputes',
      payload: {
        lane: 'citations',
        targetRef: 'section 2.1',
        text: 'Citation [3] does not support the stated claim in section 2.1.',
      },
    });

    expect(res.statusCode, res.body).toBe(200);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        authorDid: 'did:plc:reader',
        embedPaperUri: 'at://did:plc:author/app.openxiv.paper/abc',
        tags: ['trust-dispute', 'trust-lane:citations', 'trust-target:section 2.1'],
      }),
    );
    expect(res.json()).toMatchObject({
      id: 'created-dispute',
      lane: 'citations',
      targetRef: 'section 2.1',
    });
    await app.close();
  });

  it('lets the submitter answer a public Passport dispute without changing the paper', async () => {
    const create = vi.fn(() =>
      okAsync({
        id: 'created-response',
        uri: 'at://did:plc:author/app.openxiv.post/response',
        cid: null,
        authorDid: 'did:plc:author',
        text: 'Thanks, citation [3] will be clarified in the next version.',
        replyRootUri: 'at://did:plc:reader/app.openxiv.post/1',
        replyParentUri: 'at://did:plc:reader/app.openxiv.post/1',
        embedPaperUri: 'at://did:plc:author/app.openxiv.paper/abc',
        embedExternal: null,
        tags: ['trust-dispute-response', 'trust-lane:citations', 'trust-response-to:post-dispute'],
        langs: null,
        pinnedByAuthor: false,
        label: null,
        hiddenByMod: false,
        createdAt: new Date('2026-05-19T12:10:00.000Z'),
      }),
    );
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('ctx', passportContext({ create }));
    app.decorate('requireAuth', async (req: unknown) => {
      (req as { session?: SessionPayload }).session = {
        uid: 'author-1',
        did: 'did:plc:author',
        role: 'author',
        exp: Math.floor(Date.now() / 1000) + 60,
      };
    });
    await app.register(papersRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/papers/gr-qc.2026.00001/passport/disputes/post-dispute/responses',
      payload: {
        text: 'Thanks, citation [3] will be clarified in the next version.',
      },
    });

    expect(res.statusCode, res.body).toBe(200);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        authorDid: 'did:plc:author',
        replyRootUri: 'at://did:plc:reader/app.openxiv.post/1',
        replyParentUri: 'at://did:plc:reader/app.openxiv.post/1',
        embedPaperUri: 'at://did:plc:author/app.openxiv.paper/abc',
        tags: ['trust-dispute-response', 'trust-lane:citations', 'trust-response-to:post-dispute'],
      }),
    );
    expect(res.json()).toMatchObject({
      id: 'created-response',
      disputeId: 'post-dispute',
      lane: 'citations',
    });
    await app.close();
  });

  it('lets the submitter mark a Passport dispute resolved without changing the paper', async () => {
    const setLabel = vi.fn(() =>
      okAsync({
        id: 'post-dispute',
        uri: 'at://did:plc:reader/app.openxiv.post/1',
        cid: null,
        authorDid: 'did:plc:reader',
        text: 'Citation [3] does not appear to support the claim in section 2.1.',
        replyRootUri: null,
        replyParentUri: null,
        embedPaperUri: 'at://did:plc:author/app.openxiv.paper/abc',
        embedExternal: null,
        tags: ['trust-dispute', 'trust-lane:citations', 'trust-target:section 2.1'],
        langs: null,
        pinnedByAuthor: false,
        label: 'resolved_by_v2',
        hiddenByMod: false,
        createdAt: new Date('2026-05-19T12:05:00.000Z'),
      }),
    );
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('ctx', passportContext({ setLabel }));
    app.decorate('requireAuth', async (req: unknown) => {
      (req as { session?: SessionPayload }).session = {
        uid: 'author-1',
        did: 'did:plc:author',
        role: 'author',
        exp: Math.floor(Date.now() / 1000) + 60,
      };
    });
    await app.register(papersRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/papers/gr-qc.2026.00001/passport/disputes/post-dispute/status',
      payload: { status: 'resolved' },
    });

    expect(res.statusCode, res.body).toBe(200);
    expect(setLabel).toHaveBeenCalledWith('post-dispute', 'resolved_by_v2');
    expect(res.json()).toMatchObject({
      id: 'post-dispute',
      lane: 'citations',
      status: 'resolved',
      label: 'resolved_by_v2',
    });
    await app.close();
  });

  it('accepts a signed external lane attestation and rejects tampering', async () => {
    const external = generateKeypair();
    const create = vi.fn(() =>
      okAsync({
        id: 'created-attestation',
        uri: 'at://did:web:biorxiv.org/app.openxiv.post/attested',
        cid: null,
        authorDid: 'did:web:biorxiv.org',
        text: 'We independently verified the dataset integrity lane.',
        replyRootUri: null,
        replyParentUri: null,
        embedPaperUri: 'at://did:plc:author/app.openxiv.paper/abc',
        embedExternal: {
          uri: 'https://biorxiv.org/openxiv-attestations/gr-qc.2026.00001',
          title: 'Signed Passport attestation',
          description: 'signature',
        },
        tags: [],
        langs: null,
        pinnedByAuthor: false,
        label: null,
        hiddenByMod: false,
        createdAt: new Date('2026-05-19T12:09:00.000Z'),
      }),
    );
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('ctx', passportContext({ create }));
    await app.register(papersRoutes);

    const createdAt = '2026-05-19T12:09:00.000Z';
    const payload = {
      issuer: 'did:web:biorxiv.org',
      publicKeyMultibase: external.multibase,
      paper_id: 'openxiv:gr-qc.2026.00001',
      lane: 'integrity',
      statement: 'We independently verified the dataset integrity lane.',
      verificationUrl: 'https://biorxiv.org/openxiv-attestations/gr-qc.2026.00001',
      createdAt,
    } as const;
    const signature = Buffer.from(
      sign(utf8(canonicalJson(externalAttestationSigningPayload(payload))), external.privateKey, {
        format: 'compact',
      }),
    ).toString('base64url');

    const res = await app.inject({
      method: 'POST',
      url: '/papers/gr-qc.2026.00001/passport/attestations',
      payload: { ...payload, signature },
    });

    expect(res.statusCode, res.body).toBe(200);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        authorDid: 'did:web:biorxiv.org',
        embedPaperUri: 'at://did:plc:author/app.openxiv.paper/abc',
        text: payload.statement,
        tags: [
          'trust-attestation',
          'trust-lane:integrity',
          'trust-issuer:did:web:biorxiv.org',
          `trust-pubkey:${external.multibase}`,
          `trust-created-at:${payload.createdAt}`,
        ],
      }),
    );
    expect(res.json()).toMatchObject({
      id: 'created-attestation',
      issuer: 'did:web:biorxiv.org',
      lane: 'integrity',
      publicKeyMultibase: external.multibase,
      signatureVerified: true,
    });

    const tampered = await app.inject({
      method: 'POST',
      url: '/papers/gr-qc.2026.00001/passport/attestations',
      payload: { ...payload, statement: 'Tampered statement.', signature },
    });
    expect(tampered.statusCode).toBe(400);
    expect(create).toHaveBeenCalledTimes(1);

    await app.close();
  });
});

void hashes;

function passportContext(
  overrides: {
    create?: ReturnType<typeof vi.fn>;
    setLabel?: ReturnType<typeof vi.fn>;
    forPaperUri?: ReturnType<typeof vi.fn>;
    loaded?: ReturnType<typeof loadedPaper>;
    storageGet?: ReturnType<typeof vi.fn>;
    sections?: Array<{
      id: string;
      paperId: string;
      sectionIdx: number;
      title: string;
      anchor: string;
      content: string;
      embedding: never[];
      model: string;
      createdAt: Date;
    }>;
  } = {},
) {
  const attestationCreatedAt = '2026-05-19T12:08:00.000Z';
  const attestationStatement = 'We independently verified the dataset integrity lane.';
  const attestationVerificationUrl = 'https://biorxiv.org/openxiv-attestations/gr-qc.2026.00001';
  const attestationKey = generateKeypair();
  const attestationPayload = {
    issuer: 'did:web:biorxiv.org',
    publicKeyMultibase: attestationKey.multibase,
    paper_id: 'openxiv:gr-qc.2026.00001',
    lane: 'integrity',
    statement: attestationStatement,
    verificationUrl: attestationVerificationUrl,
    createdAt: attestationCreatedAt,
  } as const;
  const attestationSignature = Buffer.from(
    sign(
      utf8(canonicalJson(externalAttestationSigningPayload(attestationPayload))),
      attestationKey.privateKey,
      {
        format: 'compact',
      },
    ),
  ).toString('base64url');

  return {
    env: {
      PUBLIC_WEB_BASE: 'https://openxiv.net',
      FEED_GENERATOR_DID: 'did:web:openxiv.net',
      JWT_SECRET: 'test-jwt-secret-with-enough-entropy-123',
    },
    repos: {
      papers: {
        findById: vi.fn(),
        findByOpenxivId: vi.fn(() =>
          okAsync({
            id: 'paper-uuid',
            submitterDid: 'did:plc:author',
            uri: 'at://did:plc:author/app.openxiv.paper/abc',
          }),
        ),
        list: vi.fn(),
        loadWithRelations: vi.fn(() => okAsync(overrides.loaded ?? loadedPaper())),
      },
      endorsements: {
        statsForPaper: vi.fn(() => okAsync({ total: 2, distinctVerbs: 2, byVerb: {} })),
      },
      sections: {
        firstIndexedAt: vi.fn(() => okAsync(new Date('2026-05-19T12:02:00.000Z'))),
        forPaper: vi.fn(() =>
          okAsync(
            overrides.sections ?? [
              {
                id: 'section-1',
                paperId: 'paper-uuid',
                sectionIdx: 0,
                title: 'Proof of the main result',
                anchor: 'proof-main',
                content:
                  'Theorem 1. For all M > 0 the metric satisfies K = 96 M^2 / l^6 [1,2]. Proof. Equation (2.1) follows from \\frac{d}{dr} f(r) and \\int_0^r rho(s) ds; the comparison follows from [3]. Related checks use [1] [2] [3] [4] [5] [6] [7] [8].',
                embedding: [],
                model: 'test',
                createdAt: new Date('2026-05-19T12:02:00.000Z'),
              },
              {
                id: 'section-2',
                paperId: 'paper-uuid',
                sectionIdx: 1,
                title: 'References',
                anchor: 'references',
                content:
                  '[1] A. Einstein, Annalen der Physik. doi:10.1002/andp.19163540702\n[2] R. Penrose, Phys. Rev. Lett. https://doi.org/10.1103/PhysRevLett.14.57\n[3] D. Alfyorov, arXiv:2601.00001\n[4] H. Weyl, Space Time Matter. doi:10.1007/978-3-663-14644-0\n[5] S. Hawking, Commun. Math. Phys. doi:10.1007/BF02345020\n[6] R. Wald, arXiv:gr-qc/9305022\n[7] E. Poisson, A Relativist Toolkit.\n[8] M. Visser, Lorentzian Wormholes.',
                embedding: [],
                model: 'test',
                createdAt: new Date('2026-05-19T12:02:00.000Z'),
              },
            ],
          ),
        ),
      },
      posts: {
        findById: vi.fn((id: string) => {
          if (id !== 'post-dispute') return okAsync(null);
          return okAsync({
            id: 'post-dispute',
            uri: 'at://did:plc:reader/app.openxiv.post/1',
            cid: null,
            authorDid: 'did:plc:reader',
            text: 'Citation [3] does not appear to support the claim in section 2.1.',
            replyRootUri: null,
            replyParentUri: null,
            embedPaperUri: 'at://did:plc:author/app.openxiv.paper/abc',
            embedExternal: null,
            tags: ['trust-dispute', 'trust-lane:citations', 'trust-target:section 2.1'],
            langs: null,
            pinnedByAuthor: false,
            label: null,
            hiddenByMod: false,
            createdAt: new Date('2026-05-19T12:05:00.000Z'),
          });
        }),
        forPaperUri: overrides.forPaperUri ?? vi.fn(() =>
          okAsync([
            {
              id: 'post-dispute',
              uri: 'at://did:plc:reader/app.openxiv.post/1',
              cid: null,
              authorDid: 'did:plc:reader',
              text: 'Citation [3] does not appear to support the claim in section 2.1.',
              replyRootUri: null,
              replyParentUri: null,
              embedPaperUri: 'at://did:plc:author/app.openxiv.paper/abc',
              embedExternal: null,
              tags: ['trust-dispute', 'trust-lane:citations', 'trust-target:section 2.1'],
              langs: null,
              pinnedByAuthor: false,
              label: null,
              hiddenByMod: false,
              createdAt: new Date('2026-05-19T12:05:00.000Z'),
            },
            {
              id: 'post-general',
              uri: 'at://did:plc:reader/app.openxiv.post/2',
              cid: null,
              authorDid: 'did:plc:reader',
              text: 'General discussion should not enter the Passport.',
              replyRootUri: null,
              replyParentUri: null,
              embedPaperUri: 'at://did:plc:author/app.openxiv.paper/abc',
              embedExternal: null,
              tags: [],
              langs: null,
              pinnedByAuthor: false,
              label: null,
              hiddenByMod: false,
              createdAt: new Date('2026-05-19T12:06:00.000Z'),
            },
            {
              id: 'post-dispute-response',
              uri: 'at://did:plc:author/app.openxiv.post/response',
              cid: null,
              authorDid: 'did:plc:author',
              text: 'Thanks, this will be clarified in the next version.',
              replyRootUri: 'at://did:plc:reader/app.openxiv.post/1',
              replyParentUri: 'at://did:plc:reader/app.openxiv.post/1',
              embedPaperUri: 'at://did:plc:author/app.openxiv.paper/abc',
              embedExternal: null,
              tags: [
                'trust-dispute-response',
                'trust-lane:citations',
                'trust-response-to:post-dispute',
              ],
              langs: null,
              pinnedByAuthor: false,
              label: null,
              hiddenByMod: false,
              createdAt: new Date('2026-05-19T12:07:30.000Z'),
            },
            {
              id: 'post-attestation',
              uri: 'at://did:web:biorxiv.org/app.openxiv.post/3',
              cid: null,
              authorDid: 'did:web:biorxiv.org',
              text: attestationStatement,
              replyRootUri: null,
              replyParentUri: null,
              embedPaperUri: 'at://did:plc:author/app.openxiv.paper/abc',
              embedExternal: {
                uri: attestationVerificationUrl,
                title: 'bioRxiv signed integrity attestation',
                description: attestationSignature,
              },
              tags: [
                'trust-attestation',
                'trust-lane:integrity',
                'trust-issuer:did:web:biorxiv.org',
                `trust-pubkey:${attestationKey.multibase}`,
                `trust-created-at:${attestationCreatedAt}`,
              ],
              langs: null,
              pinnedByAuthor: false,
              label: null,
              hiddenByMod: false,
              createdAt: new Date('2026-05-19T12:08:59.000Z'),
            },
          ]),
        ),
        create: overrides.create ?? vi.fn(),
        setLabel: overrides.setLabel ?? vi.fn(),
      },
    },
    clients: {
      storage: {
        get:
          overrides.storageGet ??
          vi.fn((key: string) =>
            okAsync({
              key,
              contentType: 'application/octet-stream',
              body: Buffer.alloc(0),
            }),
          ),
      },
    },
  } as unknown as AppContext;
}

function loadedPaper(overrides: { sourceKey?: string | null } = {}) {
  const now = new Date('2026-05-19T12:00:00.000Z');
  return {
    paper: {
      id: 'paper-uuid',
      openxivId: 'openxiv:gr-qc.2026.00001',
      uri: 'at://did:plc:author/app.openxiv.paper/abc',
      cid: 'cid',
      submitterDid: 'did:plc:author',
      title: 'A test paper',
      abstract: 'Abstract',
      license: 'CC-BY-4.0',
      primaryCategory: 'gr-qc',
      crossListings: [],
      doi: null,
      status: 'published',
      versionNote: null,
      supersedesUri: null,
      submissionTermsVersion: null,
      submissionTermsAcceptedAt: null,
      oneHardQuestion: null,
      launchKit: null,
      createdAt: now,
      updatedAt: now,
      publishedAt: now,
    },
    authors: [
      {
        paperId: 'paper-uuid',
        position: 0,
        did: null,
        displayName: 'Author',
        orcid: '0000-0000-0000-0001',
        affiliation: null,
        affiliationRor: null,
        creditRoles: [],
        isCorresponding: true,
      },
    ],
    categories: ['gr-qc'],
    keywords: [],
    latestVersion: {
      id: 'version-1',
      paperId: 'paper-uuid',
      versionNumber: 1,
      sourceKey: overrides.sourceKey ?? 'source.zip',
      pdfKey: 'paper.pdf',
      htmlKey: 'paper.html',
      finalPdfUrl: null,
      finalPdfContentHash: null,
      finalPdfBuiltAt: null,
      fileSha256: 'sha256',
      sizeBytes: 123,
      pageCount: 2,
      changelogNote: null,
      changeFlags: null,
      becauseOf: null,
      unresolved: null,
      diffUrl: null,
      previousVersionId: null,
      bskyPostUri: null,
      bskyPostCid: null,
      bskyThreadReplies: [],
      bridgeStatus: 'skipped',
      bridgeError: null,
      bridgeAttemptedAt: null,
      mastodonStatusId: null,
      mastodonStatusUrl: null,
      mastodonPostStatus: 'none',
      mastodonPostError: null,
      mastodonPostedAt: null,
      createdAt: now,
      publishedAt: now,
    },
    disclosure: {
      id: 'disc-1',
      paperId: 'paper-uuid',
      level: 'none',
      aiUsed: [],
      models: [],
      notes: null,
      summaryAiGenerated: false,
      humanVerified: true,
      attestation: 'attested',
      uri: null,
      createdAt: now,
    },
    summaries: [],
    detectorScore: { id: 'score-1', paperId: 'paper-uuid', score: 10, computedAt: now },
  };
}
