-- Bluesky cross-post tracking on paper_versions, plus dedicated tables for
-- follows mirroring and labeler-emitted labels. The bridge needs to remember
-- which app.bsky.feed.post URI corresponds to a given paper version so v2+
-- can be threaded as replies.

ALTER TABLE paper_versions
  ADD COLUMN IF NOT EXISTS bsky_post_uri text,
  ADD COLUMN IF NOT EXISTS bsky_post_cid text,
  ADD COLUMN IF NOT EXISTS bridge_status text NOT NULL DEFAULT 'none'
    CHECK (bridge_status IN ('none', 'pending', 'posted', 'failed', 'skipped')),
  ADD COLUMN IF NOT EXISTS bridge_error text,
  ADD COLUMN IF NOT EXISTS bridge_attempted_at timestamptz,
  -- Auto-thread state for papers with >=2 claim cards. Stores an array of
  -- {claim_idx, uri, cid} so each claim's reply can be idempotent across
  -- saga retries. Empty array = no replies posted yet.
  ADD COLUMN IF NOT EXISTS bsky_thread_replies jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS paper_versions_bsky_uri_idx ON paper_versions (bsky_post_uri);

-- Mirror of `app.bsky.graph.follow` records the user has on Bluesky.
-- Fetched at sign-in (opt-out via users.bsky_follows_opt_out) so an author
-- profile page can show "you follow on Bluesky" without proxying live calls.
CREATE TABLE IF NOT EXISTS bsky_follows (
  follower_did text NOT NULL,
  following_did text NOT NULL,
  following_handle text,
  following_display_name text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_did, following_did)
);

CREATE INDEX IF NOT EXISTS bsky_follows_following_idx ON bsky_follows (following_did);
CREATE INDEX IF NOT EXISTS bsky_follows_fetched_idx ON bsky_follows (fetched_at);

-- Labels emitted by OpenXiv's labeler service over app.bsky.feed.post records
-- that mention or quote an OpenXiv paper. Sourced from the jetstream consumer
-- (or a one-shot backfill); served via com.atproto.label.queryLabels.
CREATE TABLE IF NOT EXISTS bsky_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  src text NOT NULL,
  uri text NOT NULL,
  cid text,
  val text NOT NULL,
  neg boolean NOT NULL DEFAULT false,
  cts timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bsky_labels_uri_idx ON bsky_labels (uri);
CREATE INDEX IF NOT EXISTS bsky_labels_val_idx ON bsky_labels (val);
CREATE UNIQUE INDEX IF NOT EXISTS bsky_labels_unique_active_idx
  ON bsky_labels (uri, val) WHERE neg = false;
