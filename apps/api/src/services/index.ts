export * from './users.js';
export * from './submissions.js';
export * from './feed.js';
export * from './explain.js';
export * from './posts.js';
export * from './intake.js';
export * from './suggest.js';
export * from './sections.js';
export * from './llm-budget.js';
export * from './flags.js';
export * from './engagement-stats.js';

import { makeExplainService, type ExplainService } from './explain.js';
import { makeFeedService, type FeedService } from './feed.js';
import { makeIntakeService, type IntakeService } from './intake.js';
import { makeLlmBudget, type LlmBudget } from './llm-budget.js';
import { makePostsService, type PostsService } from './posts.js';
import {
  makeSearchService,
  makeSectionsIndexer,
  type SearchService,
  type SectionsIndexer,
} from './sections.js';
import { makeSubmissionsService, type SubmissionsService } from './submissions.js';
import { makeSuggestService, type SuggestService } from './suggest.js';
import { makeUsersService, type UsersService } from './users.js';
import { makeFlagsService, type FlagsService } from './flags.js';
import type { AppContext } from '../context.js';
import type { FastifyBaseLogger } from 'fastify';

export interface Services {
  readonly users: UsersService;
  readonly submissions: SubmissionsService;
  readonly feed: FeedService;
  readonly explain: ExplainService;
  readonly posts: PostsService;
  readonly intake: IntakeService;
  readonly suggest: SuggestService;
  readonly search: SearchService;
  readonly sectionsIndexer: SectionsIndexer;
  readonly llmBudget: LlmBudget;
  readonly flags: FlagsService;
}

export function buildServices(ctx: AppContext, logger?: FastifyBaseLogger): Services {
  const intake = makeIntakeService(ctx);
  const llmBudget = makeLlmBudget(ctx);
  return {
    users: makeUsersService(ctx),
    submissions: makeSubmissionsService(ctx),
    feed: makeFeedService(ctx),
    explain: makeExplainService(ctx),
    posts: makePostsService(ctx),
    intake,
    suggest: makeSuggestService(ctx, intake, logger),
    search: makeSearchService(ctx),
    sectionsIndexer: makeSectionsIndexer(ctx),
    llmBudget,
    flags: makeFlagsService(ctx),
  };
}
