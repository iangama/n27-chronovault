CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS es_events (
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  stream      TEXT NOT NULL,
  stream_seq  BIGINT NOT NULL,
  type        TEXT NOT NULL,
  actor       TEXT NOT NULL,
  capsule_id  UUID NULL,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  meta        JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash   TEXT NOT NULL,
  hash        TEXT NOT NULL,
  UNIQUE(stream, stream_seq)
);

CREATE INDEX IF NOT EXISTS idx_es_events_capsule ON es_events(capsule_id);
CREATE INDEX IF NOT EXISTS idx_es_events_ts ON es_events(ts);

CREATE TABLE IF NOT EXISTS pr_capsules (
  id           UUID PRIMARY KEY,
  title        TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags         TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  seal_level   INT NOT NULL CHECK (seal_level BETWEEN 1 AND 5),
  status       TEXT NOT NULL CHECK (status IN ('open','sealed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  sealed_at    TIMESTAMPTZ NULL,
  last_event_id BIGINT NULL
);

CREATE INDEX IF NOT EXISTS idx_pr_capsules_status ON pr_capsules(status);
CREATE INDEX IF NOT EXISTS idx_pr_capsules_title ON pr_capsules(title);

CREATE TABLE IF NOT EXISTS so_comments (
  id         BIGSERIAL PRIMARY KEY,
  ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
  capsule_id UUID NOT NULL,
  actor      TEXT NOT NULL DEFAULT 'anonymous',
  body       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS so_reactions (
  id         BIGSERIAL PRIMARY KEY,
  ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
  capsule_id UUID NOT NULL,
  actor      TEXT NOT NULL DEFAULT 'anonymous',
  kind       TEXT NOT NULL CHECK (kind IN ('like','dislike','flag','ack'))
);

CREATE TABLE IF NOT EXISTS so_views (
  id         BIGSERIAL PRIMARY KEY,
  ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
  capsule_id UUID NOT NULL,
  actor      TEXT NOT NULL DEFAULT 'anonymous'
);
