import type { AppEnv } from '@openxiv/shared';
import { DEFAULT_HTTP_TIMEOUT_MS } from './http.js';
import { makeTectonicCompiler } from './compiler/tectonic.js';
import { makeMockCompiler } from './compiler/mock.js';
import type { LatexCompiler } from './compiler/interface.js';
import { makeHeuristicDetector } from './detector/heuristic.js';
import { makeMockDetector } from './detector/mock.js';
import type { AiDetector } from './detector/interface.js';
import { makeGrobidExtractor } from './grobid/real.js';
import { makeMockGrobidExtractor } from './grobid/mock.js';
import type { GrobidExtractor } from './grobid/interface.js';
import { makeTfidfKeywordExtractor } from './keywords/tfidf.js';
import type { KeywordExtractor } from './keywords/interface.js';
import { makeLatexmlConverter } from './latexml/real.js';
import { makeMockLatexmlConverter } from './latexml/mock.js';
import type { LatexmlConverter } from './latexml/interface.js';
import { makeDeepseekClient } from './llm/deepseek.js';
import { makeGeminiClient } from './llm/gemini.js';
import { makeMockLlmClient } from './llm/mock.js';
import { withBreaker } from './llm/breaker.js';
import type { LlmClient } from './llm/interface.js';
import { makeGoogleOAuthClient } from './oauth/google.js';
import { makeOrcidOAuthClient } from './oauth/orcid.js';
import { makeMockOAuthClient } from './oauth/mock.js';
import type { OAuthClient } from './oauth/interface.js';
import { makeBlueskyAuthClient, makeMockBlueskyAuthClient } from './bluesky/client.js';
import type { BlueskyAuthClient } from './bluesky/interface.js';
import type { Redis } from 'ioredis';
import { makeAtProtoPdsClient } from './pds/real.js';
import { makeMockPdsClient } from './pds/mock.js';
import type { AtProtoPdsClient } from './pds/interface.js';
import { makeMockStorageClient } from './storage/mock.js';
import { makeS3StorageClient } from './storage/s3.js';
import type { StorageClient } from './storage/interface.js';
import {
  withCompilerBreaker,
  withGrobidBreaker,
  withLatexmlBreaker,
  withOAuthBreaker,
  withPdsBreaker,
  withStorageBreaker,
} from './external-breakers.js';

export interface Clients {
  readonly storage: StorageClient;
  readonly llm: LlmClient;
  readonly compiler: LatexCompiler;
  readonly grobid: GrobidExtractor;
  readonly latexml: LatexmlConverter;
  readonly keywords: KeywordExtractor;
  readonly detector: AiDetector;
  readonly pds: AtProtoPdsClient;
  readonly orcid: OAuthClient;
  readonly google: OAuthClient;
  readonly bluesky: BlueskyAuthClient;
}

export interface ClientsDeps {
  readonly redis: Redis;
}

/** Build the full set of clients from environment + global mock flags. */
export function buildClients(env: AppEnv, deps: ClientsDeps): Clients {
  const mockAll = env.USE_MOCK_CLIENTS;

  const storage = withStorageBreaker(
    makeS3StorageClient({
      endpoint: env.S3_ENDPOINT,
      publicEndpoint: env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      bucket: env.S3_BUCKET,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    }),
    { name: 's3', timeoutMs: DEFAULT_HTTP_TIMEOUT_MS },
  );

  // LLM provider precedence:
  //   1. mocks (global or USE_MOCK_LLM)
  //   2. DeepSeek if DEEPSEEK_API_KEY (text); Gemini layered in as embedding
  //      fallback when GEMINI_API_KEY is also present. Otherwise DeepSeek
  //      uses a deterministic hash surrogate for embeddings.
  //   3. Gemini-only when only GEMINI_API_KEY is set
  //   4. mock otherwise
  const llm: LlmClient = (() => {
    if (mockAll || env.USE_MOCK_LLM) return makeMockLlmClient();
    const hasDeepseek = env.DEEPSEEK_API_KEY.length > 0;
    const hasGemini = env.GEMINI_API_KEY.length > 0;
    if (hasDeepseek) {
      // Wrap the embedding-fallback (Gemini) in its own breaker before
      // passing it into the DeepSeek shim, so an embedding outage doesn't
      // domino into text generation latency.
      const rawGeminiForEmbed = hasGemini
        ? makeGeminiClient({
            apiKey: env.GEMINI_API_KEY,
            textModel: env.GEMINI_MODEL_TEXT,
            embedModel: env.GEMINI_MODEL_EMBED,
            embedDimensions: 768,
          })
        : undefined;
      const embeddingFallback: LlmClient | undefined = rawGeminiForEmbed
        ? withBreaker(rawGeminiForEmbed, { name: 'gemini-embed' })
        : undefined;
      const deepseekRaw = makeDeepseekClient({
        apiKey: env.DEEPSEEK_API_KEY,
        baseUrl: env.DEEPSEEK_BASE_URL,
        textModel: env.DEEPSEEK_MODEL_TEXT,
        ...(embeddingFallback ? { embeddingFallback } : {}),
      });
      return withBreaker(deepseekRaw, { name: 'deepseek' });
    }
    if (hasGemini) {
      return withBreaker(
        makeGeminiClient({
          apiKey: env.GEMINI_API_KEY,
          textModel: env.GEMINI_MODEL_TEXT,
          embedModel: env.GEMINI_MODEL_EMBED,
          embedDimensions: 768,
        }),
        { name: 'gemini' },
      );
    }
    return makeMockLlmClient();
  })();

  const compiler: LatexCompiler =
    mockAll || env.USE_MOCK_TECTONIC
      ? makeMockCompiler()
      : withCompilerBreaker(
          makeTectonicCompiler({
            dockerImage: env.TECTONIC_DOCKER_IMAGE,
            timeoutMs: env.TECTONIC_TIMEOUT_MS,
          }),
          { name: 'tectonic', timeoutMs: env.TECTONIC_TIMEOUT_MS },
        );

  const grobid: GrobidExtractor =
    mockAll || env.USE_MOCK_GROBID
      ? makeMockGrobidExtractor()
      : withGrobidBreaker(makeGrobidExtractor({ url: env.GROBID_URL }), {
          name: 'grobid',
          timeoutMs: DEFAULT_HTTP_TIMEOUT_MS,
        });

  const latexml: LatexmlConverter =
    mockAll || env.USE_MOCK_LATEXML
      ? makeMockLatexmlConverter()
      : withLatexmlBreaker(
          makeLatexmlConverter({
            timeoutMs: env.LATEXML_TIMEOUT_MS,
          }),
          { name: 'latexml', timeoutMs: env.LATEXML_TIMEOUT_MS },
        );

  const detector: AiDetector =
    mockAll || env.USE_MOCK_DETECTOR ? makeMockDetector() : makeHeuristicDetector();

  const orcid: OAuthClient =
    mockAll || env.USE_MOCK_ORCID || !env.ORCID_CLIENT_ID
      ? makeMockOAuthClient('orcid')
      : withOAuthBreaker(
          makeOrcidOAuthClient({
            clientId: env.ORCID_CLIENT_ID,
            clientSecret: env.ORCID_CLIENT_SECRET,
            redirectUri: env.ORCID_REDIRECT_URI,
            useSandbox: env.ORCID_USE_SANDBOX,
          }),
          { name: 'orcid', timeoutMs: DEFAULT_HTTP_TIMEOUT_MS },
        );

  const google: OAuthClient =
    mockAll || !env.GOOGLE_CLIENT_ID
      ? makeMockOAuthClient('google')
      : withOAuthBreaker(
          makeGoogleOAuthClient({
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            redirectUri: env.GOOGLE_REDIRECT_URI,
          }),
          { name: 'google', timeoutMs: DEFAULT_HTTP_TIMEOUT_MS },
        );

  const bluesky: BlueskyAuthClient =
    mockAll || env.USE_MOCK_BLUESKY
      ? makeMockBlueskyAuthClient(deps.redis)
      : makeBlueskyAuthClient({
          clientId: env.BLUESKY_OAUTH_CLIENT_ID,
          redirectUri: env.BLUESKY_OAUTH_REDIRECT_URI,
          publicBase: env.PUBLIC_WEB_BASE,
          redis: deps.redis,
          allowHttp: env.NODE_ENV !== 'production',
        });

  const pds: AtProtoPdsClient =
    mockAll || env.USE_MOCK_BLUESKY
      ? makeMockPdsClient()
      : withPdsBreaker(makeAtProtoPdsClient({ serviceUrl: env.ATPROTO_SERVICE_URL }), {
          name: 'pds',
          timeoutMs: DEFAULT_HTTP_TIMEOUT_MS,
        });

  return {
    storage: mockAll ? makeMockStorageClient() : storage,
    llm,
    compiler,
    grobid,
    latexml,
    keywords: makeTfidfKeywordExtractor(),
    detector,
    pds,
    orcid,
    google,
    bluesky,
  };
}
