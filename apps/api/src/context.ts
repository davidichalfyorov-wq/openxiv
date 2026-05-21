import { buildClients, type Clients } from '@openxiv/clients';
import {
  createDb,
  makeEmbeddingsRepository,
  makeFollowsRepository,
  makeIdAllocator,
  makeJobsRepository,
  makePapersRepository,
  makePostsRepository,
  makePreregistrationsRepository,
  makeSagasRepository,
  makeSectionsRepository,
  makeSessionsRepository,
  makeStatsRepository,
  makeUsersRepository,
  makeBskyFeedsRepository,
  makeBskyFollowsRepository,
  makeBskyLabelsRepository,
  makePaperEditsRepository,
  makePaperLabelsRepository,
  makePaperArtifactsRepository,
  makePaperEnrichmentRepository,
  makeReservedDidsRepository,
  makeAccountLinksRepository,
  makeDailyBriefsRepository,
  makeEndorsementsRepository,
  makeProfileCardsRepository,
  makeProfileModesRepository,
  makeEventsRepository,
  makeExternalPapersRepository,
  makeFeaturedRepository,
  makeRefusalsRepository,
  makeTopicsRepository,
  makePaperFiguresRepository,
  type DbHandle,
  type EmbeddingsRepository,
  type FollowsRepository,
  type IdAllocator,
  type JobsRepository,
  type PapersRepository,
  type PostsRepository,
  type PreregistrationsRepository,
  type SagasRepository,
  type SectionsRepository,
  type SessionsRepository,
  type StatsRepository,
  type UsersRepository,
  type BskyFeedsRepository,
  type BskyFollowsRepository,
  type BskyLabelsRepository,
  type PaperEditsRepository,
  type PaperLabelsRepository,
  type PaperArtifactsRepository,
  type PaperEnrichmentRepository,
  type ReservedDidsRepository,
  type AccountLinksRepository,
  type DailyBriefsRepository,
  type EndorsementsRepository,
  type ProfileCardsRepository,
  type ProfileModesRepository,
  type EventsRepository,
  type ExternalPapersRepository,
  type FeaturedRepository,
  type RefusalsRepository,
  type TopicsRepository,
  type PaperFiguresRepository,
} from '@openxiv/db';
import type { AppEnv } from '@openxiv/shared';
import { Queue, type ConnectionOptions } from 'bullmq';
import Redis from 'ioredis';

export interface Queues {
  readonly compile: Queue;
  readonly extract: Queue;
  readonly convertHtml: Queue;
  readonly embed: Queue;
  readonly detector: Queue;
  readonly explain: Queue;
  readonly pdfFinalize: Queue;
  readonly pdfFigures: Queue;
  readonly doiDeposit: Queue;
  readonly bskyFollow: Queue;
  readonly analyticsRollup: Queue;
  readonly mastodonCrosspost: Queue;
  close(): Promise<void>;
}

export interface AppContext {
  readonly env: AppEnv;
  readonly db: DbHandle;
  readonly redis: Redis;
  readonly clients: Clients;
  readonly queues: Queues;
  readonly repos: {
    readonly users: UsersRepository;
    readonly sessions: SessionsRepository;
    readonly papers: PapersRepository;
    readonly posts: PostsRepository;
    readonly follows: FollowsRepository;
    readonly embeddings: EmbeddingsRepository;
    readonly jobs: JobsRepository;
    readonly sagas: SagasRepository;
    readonly idAllocator: IdAllocator;
    readonly stats: StatsRepository;
    readonly preregs: PreregistrationsRepository;
    readonly sections: SectionsRepository;
    readonly endorsements: EndorsementsRepository;
    readonly topics: TopicsRepository;
    readonly refusals: RefusalsRepository;
    readonly events: EventsRepository;
    readonly externalPapers: ExternalPapersRepository;
    readonly featured: FeaturedRepository;
    readonly dailyBriefs: DailyBriefsRepository;
    readonly profileModes: ProfileModesRepository;
    readonly profileCards: ProfileCardsRepository;
    readonly bskyFeeds: BskyFeedsRepository;
    readonly bskyFollows: BskyFollowsRepository;
    readonly bskyLabels: BskyLabelsRepository;
    readonly paperEdits: PaperEditsRepository;
    readonly paperLabels: PaperLabelsRepository;
    readonly paperArtifacts: PaperArtifactsRepository;
    readonly paperEnrichment: PaperEnrichmentRepository;
    readonly reservedDids: ReservedDidsRepository;
    readonly accountLinks: AccountLinksRepository;
    readonly paperFigures: PaperFiguresRepository;
  };
  shutdown(): Promise<void>;
}

export async function buildContext(env: AppEnv): Promise<AppContext> {
  const db = createDb(env.DATABASE_URL);
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  await redis.ping();
  const clients = buildClients(env, { redis });

  const queues = buildQueues({ host: redis.options.host ?? 'localhost', port: redis.options.port ?? 6379 });

  const repos = {
    users: makeUsersRepository(db.db),
    sessions: makeSessionsRepository(db.db),
    papers: makePapersRepository(db.db),
    posts: makePostsRepository(db.db),
    follows: makeFollowsRepository(db.db),
    embeddings: makeEmbeddingsRepository(db.db),
    jobs: makeJobsRepository(db.db),
    sagas: makeSagasRepository(db.db),
    idAllocator: makeIdAllocator(db.db),
    stats: makeStatsRepository(db.db),
    preregs: makePreregistrationsRepository(db.db),
    sections: makeSectionsRepository(db.db),
    endorsements: makeEndorsementsRepository(db.db),
    topics: makeTopicsRepository(db.db),
    refusals: makeRefusalsRepository(db.db),
    events: makeEventsRepository(db.db),
    externalPapers: makeExternalPapersRepository(db.db),
    featured: makeFeaturedRepository(db.db),
    dailyBriefs: makeDailyBriefsRepository(db.db),
    profileModes: makeProfileModesRepository(db.db),
    profileCards: makeProfileCardsRepository(db.db),
    bskyFeeds: makeBskyFeedsRepository(db.db),
    bskyFollows: makeBskyFollowsRepository(db.db),
    bskyLabels: makeBskyLabelsRepository(db.db),
    paperEdits: makePaperEditsRepository(db.db),
    paperLabels: makePaperLabelsRepository(db.db),
    paperArtifacts: makePaperArtifactsRepository(db.db),
    paperEnrichment: makePaperEnrichmentRepository(db.db),
    reservedDids: makeReservedDidsRepository(db.db),
    accountLinks: makeAccountLinksRepository(db.db),
    paperFigures: makePaperFiguresRepository(db.db),
  };

  return {
    env,
    db,
    redis,
    clients,
    queues,
    repos,
    async shutdown() {
      await queues.close();
      await redis.quit().catch(() => {});
      await db.close();
    },
  };
}

export const QUEUE_NAMES = {
  compile: 'openxiv.compile',
  extract: 'openxiv.extract',
  convertHtml: 'openxiv.convert-html',
  embed: 'openxiv.embed',
  detector: 'openxiv.detector',
  explain: 'openxiv.explain',
  pdfFinalize: 'openxiv.pdf-finalize',
  pdfFigures: 'openxiv.pdf-figures',
  doiDeposit: 'openxiv.doi-deposit',
  bskyFollow: 'openxiv.bsky-follow',
  analyticsRollup: 'openxiv.analytics-rollup',
  mastodonCrosspost: 'openxiv.mastodon-crosspost',
} as const;

export function buildQueues(conn: ConnectionOptions): Queues {
  const queues = {
    compile: new Queue(QUEUE_NAMES.compile, { connection: conn }),
    extract: new Queue(QUEUE_NAMES.extract, { connection: conn }),
    convertHtml: new Queue(QUEUE_NAMES.convertHtml, { connection: conn }),
    embed: new Queue(QUEUE_NAMES.embed, { connection: conn }),
    detector: new Queue(QUEUE_NAMES.detector, { connection: conn }),
    explain: new Queue(QUEUE_NAMES.explain, { connection: conn }),
    pdfFinalize: new Queue(QUEUE_NAMES.pdfFinalize, { connection: conn }),
    pdfFigures: new Queue(QUEUE_NAMES.pdfFigures, { connection: conn }),
    doiDeposit: new Queue(QUEUE_NAMES.doiDeposit, { connection: conn }),
    bskyFollow: new Queue(QUEUE_NAMES.bskyFollow, { connection: conn }),
    analyticsRollup: new Queue(QUEUE_NAMES.analyticsRollup, { connection: conn }),
    mastodonCrosspost: new Queue(QUEUE_NAMES.mastodonCrosspost, { connection: conn }),
  };
  return {
    ...queues,
    async close() {
      await Promise.all(Object.values(queues).map((q) => q.close()));
    },
  };
}
