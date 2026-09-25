-- =====================================================================
-- PollPulse: catalog database (PostgreSQL)
--
-- PostgreSQL stores the "catalog": users, polls and their options.
-- This data is relational, small, written rarely and read a lot, so it
-- lives in SQL with a read replica for browsing and search.
--
-- The VOTES themselves are NOT here. They live in a sharded MongoDB
-- cluster (see db/mongo/), because they are written at a huge rate and are
-- only ever looked up by key. That split is the "SQL vs NoSQL" lesson of
-- this project.
-- =====================================================================

CREATE TYPE poll_status AS ENUM ('OPEN', 'CLOSED');

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL UNIQUE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- polls
-- ---------------------------------------------------------------------
CREATE TABLE polls (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question       text NOT NULL CHECK (length(question) BETWEEN 5 AND 200),
  description    text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  category       text NOT NULL DEFAULT 'general',
  creator_id     uuid REFERENCES users(id),
  status         poll_status NOT NULL DEFAULT 'OPEN',
  visibility     text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'unlisted')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  closes_at      timestamptz NOT NULL,
  closed_at      timestamptz,
  -- Denormalized copy of the live vote count, refreshed by the worker every
  -- few seconds. Used only for sorting the "Trending" feed.
  vote_count     integer NOT NULL DEFAULT 0,
  -- Exact results, written once when the poll closes (full recount).
  final_results  jsonb,
  -- Full-text search document, maintained by PostgreSQL itself.
  search         tsvector GENERATED ALWAYS AS (
                   setweight(to_tsvector('english', question), 'A') ||
                   setweight(to_tsvector('english', description), 'B')
                 ) STORED,
  CHECK (closes_at > created_at),
  CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL))
);

CREATE TRIGGER trg_polls_updated_at
  BEFORE UPDATE ON polls FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- options (2-6 per poll)
-- ---------------------------------------------------------------------
CREATE TABLE options (
  poll_id   uuid NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  id        smallint NOT NULL CHECK (id BETWEEN 1 AND 6),
  label     text NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  PRIMARY KEY (poll_id, id),
  UNIQUE (poll_id, label)
);

-- ---------------------------------------------------------------------
-- Indexes: each one matches a real query. See scripts/index-benchmark.mjs
-- for EXPLAIN ANALYZE numbers with and without them.
-- ---------------------------------------------------------------------

-- "Newest" feed: public polls, newest first.
CREATE INDEX idx_polls_new ON polls (created_at DESC)
  WHERE visibility = 'public';

-- "Trending" feed: open public polls with the most votes.
CREATE INDEX idx_polls_trending ON polls (vote_count DESC)
  WHERE status = 'OPEN' AND visibility = 'public';

-- Search box: GIN index over the tsvector (an "inverted index": word -> rows).
CREATE INDEX idx_polls_search ON polls USING GIN (search);

-- "My polls" page.
CREATE INDEX idx_polls_creator ON polls (creator_id, created_at DESC);

-- Worker: find open polls whose closing time has passed.
CREATE INDEX idx_polls_due ON polls (closes_at) WHERE status = 'OPEN';
