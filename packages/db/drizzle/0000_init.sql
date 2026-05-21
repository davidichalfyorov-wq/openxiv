-- pgvector & uuid extensions (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- Enums
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE "user_role" AS ENUM ('author', 'moderator', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "paper_status" AS ENUM (
    'draft', 'compiling', 'compile_failed', 'pending_disclosure',
    'pending_review', 'published', 'withdrawn'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "disclosure_level" AS ENUM ('none', 'assistant', 'coauthor', 'primary');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "summary_tier" AS ENUM ('school', 'undergrad', 'expert');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "job_status" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'dead');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- users + sessions + oauth + follows
-- ============================================================================
CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "did" text NOT NULL,
  "handle" text,
  "display_name" text NOT NULL,
  "avatar_url" text,
  "orcid" text,
  "google_sub" text,
  "bluesky_did" text,
  "email" text,
  "role" "user_role" NOT NULL DEFAULT 'author',
  "bio" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "users_did_idx" ON "users" ("did");
CREATE UNIQUE INDEX IF NOT EXISTS "users_orcid_idx" ON "users" ("orcid");
CREATE UNIQUE INDEX IF NOT EXISTS "users_google_idx" ON "users" ("google_sub");
CREATE UNIQUE INDEX IF NOT EXISTS "users_bluesky_idx" ON "users" ("bluesky_did");
CREATE UNIQUE INDEX IF NOT EXISTS "users_handle_idx" ON "users" ("handle");
CREATE INDEX IF NOT EXISTS "users_role_idx" ON "users" ("role");

CREATE TABLE IF NOT EXISTS "sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "user_agent" text,
  "ip" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_token_idx" ON "sessions" ("token_hash");
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" ("user_id");

CREATE TABLE IF NOT EXISTS "oauth_states" (
  "state" text PRIMARY KEY,
  "provider" text NOT NULL,
  "code_verifier" text,
  "nonce" text,
  "redirect_after" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS "oauth_states_exp_idx" ON "oauth_states" ("expires_at");
CREATE INDEX IF NOT EXISTS "oauth_states_provider_idx" ON "oauth_states" ("provider");

CREATE TABLE IF NOT EXISTS "follows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "follower_did" text NOT NULL,
  "target_did" text NOT NULL,
  "uri" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "follows_pair_idx" ON "follows" ("follower_did", "target_did");
CREATE INDEX IF NOT EXISTS "follows_target_idx" ON "follows" ("target_did");

-- ============================================================================
-- papers / versions / categories / authors / keywords / summaries / disclosures
-- ============================================================================
CREATE TABLE IF NOT EXISTS "papers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "uri" text,
  "cid" text,
  "submitter_did" text NOT NULL,
  "title" text NOT NULL,
  "abstract" text,
  "license" text NOT NULL,
  "primary_category" text NOT NULL,
  "doi" text,
  "status" "paper_status" NOT NULL DEFAULT 'draft',
  "version_note" text,
  "supersedes_uri" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "published_at" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "papers_uri_idx" ON "papers" ("uri");
CREATE INDEX IF NOT EXISTS "papers_submitter_idx" ON "papers" ("submitter_did");
CREATE INDEX IF NOT EXISTS "papers_status_idx" ON "papers" ("status");
CREATE INDEX IF NOT EXISTS "papers_published_idx" ON "papers" ("published_at");
CREATE INDEX IF NOT EXISTS "papers_primary_cat_idx" ON "papers" ("primary_category");

CREATE TABLE IF NOT EXISTS "paper_categories" (
  "paper_id" uuid NOT NULL REFERENCES "papers"("id") ON DELETE CASCADE,
  "category_code" text NOT NULL,
  "is_primary" boolean NOT NULL DEFAULT false,
  PRIMARY KEY ("paper_id", "category_code")
);
CREATE INDEX IF NOT EXISTS "paper_categories_cat_idx" ON "paper_categories" ("category_code");

CREATE TABLE IF NOT EXISTS "paper_keywords" (
  "paper_id" uuid NOT NULL REFERENCES "papers"("id") ON DELETE CASCADE,
  "keyword" text NOT NULL,
  "position" integer NOT NULL,
  PRIMARY KEY ("paper_id", "keyword")
);

CREATE TABLE IF NOT EXISTS "paper_authors" (
  "paper_id" uuid NOT NULL REFERENCES "papers"("id") ON DELETE CASCADE,
  "position" smallint NOT NULL,
  "did" text,
  "display_name" text NOT NULL,
  "orcid" text,
  "affiliation" text,
  "is_corresponding" boolean NOT NULL DEFAULT false,
  PRIMARY KEY ("paper_id", "position")
);
CREATE INDEX IF NOT EXISTS "paper_authors_did_idx" ON "paper_authors" ("did");

CREATE TABLE IF NOT EXISTS "paper_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "paper_id" uuid NOT NULL REFERENCES "papers"("id") ON DELETE CASCADE,
  "version_number" integer NOT NULL,
  "pdf_key" text,
  "source_key" text,
  "html_key" text,
  "file_sha256" text,
  "size_bytes" bigint,
  "page_count" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "published_at" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "paper_versions_paper_version_idx"
  ON "paper_versions" ("paper_id", "version_number");

CREATE TABLE IF NOT EXISTS "summaries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "paper_id" uuid NOT NULL REFERENCES "papers"("id") ON DELETE CASCADE,
  "tier" "summary_tier" NOT NULL,
  "text" text NOT NULL,
  "ai_generated" boolean NOT NULL DEFAULT false,
  "ai_model" text,
  "uri" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "summaries_paper_tier_idx" ON "summaries" ("paper_id", "tier");

CREATE TABLE IF NOT EXISTS "disclosures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "paper_id" uuid NOT NULL UNIQUE REFERENCES "papers"("id") ON DELETE CASCADE,
  "level" "disclosure_level" NOT NULL,
  "ai_used" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "models" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "notes" text,
  "summary_ai_generated" boolean NOT NULL DEFAULT false,
  "human_verified" boolean NOT NULL DEFAULT false,
  "attestation" text NOT NULL,
  "uri" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "disclosures_level_idx" ON "disclosures" ("level");

CREATE TABLE IF NOT EXISTS "explainer_cache" (
  "paper_id" uuid NOT NULL REFERENCES "papers"("id") ON DELETE CASCADE,
  "tier" "summary_tier" NOT NULL,
  "text" text NOT NULL,
  "ai_model" text NOT NULL,
  "computed_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  PRIMARY KEY ("paper_id", "tier")
);

CREATE TABLE IF NOT EXISTS "ai_detector_scores" (
  "paper_version_id" uuid PRIMARY KEY REFERENCES "paper_versions"("id") ON DELETE CASCADE,
  "paper_id" uuid NOT NULL REFERENCES "papers"("id") ON DELETE CASCADE,
  "score" integer NOT NULL,
  "burst_score" integer,
  "binoculars_score" integer,
  "stylometric_score" integer,
  "model_versions" jsonb,
  "computed_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "ai_detector_scores_paper_idx" ON "ai_detector_scores" ("paper_id");

-- ============================================================================
-- social: posts, reviews, endorsements, citations
-- ============================================================================
CREATE TABLE IF NOT EXISTS "posts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "uri" text NOT NULL,
  "cid" text,
  "author_did" text NOT NULL,
  "text" text NOT NULL,
  "reply_root_uri" text,
  "reply_parent_uri" text,
  "embed_paper_uri" text,
  "embed_external" jsonb,
  "tags" jsonb,
  "langs" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "posts_uri_idx" ON "posts" ("uri");
CREATE INDEX IF NOT EXISTS "posts_author_idx" ON "posts" ("author_did");
CREATE INDEX IF NOT EXISTS "posts_reply_parent_idx" ON "posts" ("reply_parent_uri");
CREATE INDEX IF NOT EXISTS "posts_embed_paper_idx" ON "posts" ("embed_paper_uri");
CREATE INDEX IF NOT EXISTS "posts_created_idx" ON "posts" ("created_at");

CREATE TABLE IF NOT EXISTS "reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "uri" text NOT NULL,
  "paper_id" uuid NOT NULL REFERENCES "papers"("id") ON DELETE CASCADE,
  "reviewer_did" text NOT NULL,
  "text" text NOT NULL,
  "verdict" text,
  "confidence" integer,
  "is_reviewer_expert" text NOT NULL DEFAULT 'false',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "reviews_uri_idx" ON "reviews" ("uri");
CREATE INDEX IF NOT EXISTS "reviews_paper_idx" ON "reviews" ("paper_id");
CREATE INDEX IF NOT EXISTS "reviews_reviewer_idx" ON "reviews" ("reviewer_did");

CREATE TABLE IF NOT EXISTS "endorsements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "uri" text NOT NULL,
  "paper_id" uuid NOT NULL REFERENCES "papers"("id") ON DELETE CASCADE,
  "endorser_did" text NOT NULL,
  "note" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "endorsements_uri_idx" ON "endorsements" ("uri");
CREATE INDEX IF NOT EXISTS "endorsements_paper_idx" ON "endorsements" ("paper_id");
CREATE UNIQUE INDEX IF NOT EXISTS "endorsements_pair_idx" ON "endorsements" ("paper_id", "endorser_did");

CREATE TABLE IF NOT EXISTS "citations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "uri" text NOT NULL,
  "from_uri" text NOT NULL,
  "from_did" text NOT NULL,
  "to_paper_id" uuid REFERENCES "papers"("id") ON DELETE SET NULL,
  "to_doi" text,
  "to_arxiv_id" text,
  "context" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "citations_uri_idx" ON "citations" ("uri");
CREATE INDEX IF NOT EXISTS "citations_from_idx" ON "citations" ("from_uri");
CREATE INDEX IF NOT EXISTS "citations_to_paper_idx" ON "citations" ("to_paper_id");

-- ============================================================================
-- jobs + compile artifacts
-- ============================================================================
CREATE TABLE IF NOT EXISTS "jobs_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "queue" text NOT NULL,
  "job_id" text NOT NULL,
  "status" "job_status" NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "payload" jsonb,
  "result" jsonb,
  "error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "jobs_log_queue_idx" ON "jobs_log" ("queue");
CREATE INDEX IF NOT EXISTS "jobs_log_status_idx" ON "jobs_log" ("status");
CREATE INDEX IF NOT EXISTS "jobs_log_job_idx" ON "jobs_log" ("job_id");

CREATE TABLE IF NOT EXISTS "compile_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "paper_version_id" uuid NOT NULL,
  "success" text NOT NULL,
  "log" text,
  "duration_ms" integer,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "compile_artifacts_version_idx" ON "compile_artifacts" ("paper_version_id");

-- ============================================================================
-- embeddings (pgvector hnsw)
-- ============================================================================
CREATE TABLE IF NOT EXISTS "paper_embeddings" (
  "paper_id" uuid PRIMARY KEY REFERENCES "papers"("id") ON DELETE CASCADE,
  "embedding" vector(768) NOT NULL,
  "model" text NOT NULL,
  "dim" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "paper_embeddings_hnsw_idx"
  ON "paper_embeddings" USING hnsw ("embedding" vector_cosine_ops);
