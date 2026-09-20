-- One row per worker, keyed by the two halves of the stratum login. The unique
-- constraint is the attribution invariant: a worker that reconnects, changes
-- rigs or is briefly offline must land on the same row, because that row id is
-- what every share in share_buckets points at.
CREATE TABLE workers (
  id            INTEGER PRIMARY KEY,
  username      TEXT    NOT NULL,
  worker_name   TEXT    NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  UNIQUE (username, worker_name)
);

-- Shares rolled into five-minute buckets. Raw shares are never stored: a single
-- mid-size rig submits on the order of a share per second, so raw rows would
-- reach tens of millions per worker per year and make the accounting table
-- unqueryable long before it is ever paid out of.
--
-- accepted counts only what upstream answered with result true and no error.
-- rejected counts everything else upstream answered, and neither column is ever
-- derived from what a worker claims to have done.
--
-- accepted_difficulty is the summed share weight, which is the only honest
-- basis for an estimated hashrate; share counts alone say nothing once the
-- upstream vardiff moves.
--
-- accepted_usd_micros is the submit-time value of the credited shares, in
-- millionths of a dollar so the running total never drifts the way a float
-- would. It stays zero until pricing lands. The column exists now because it is
-- the one value here that cannot be reconstructed afterwards: a column can be
-- added to this table later, but the price at the moment a share was submitted
-- is gone once the moment passes.
CREATE TABLE share_buckets (
  worker_id           INTEGER NOT NULL REFERENCES workers (id),
  bucket_start        INTEGER NOT NULL,
  algo                TEXT    NOT NULL,
  accepted            INTEGER NOT NULL DEFAULT 0,
  rejected            INTEGER NOT NULL DEFAULT 0,
  accepted_difficulty REAL    NOT NULL DEFAULT 0,
  accepted_usd_micros INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (worker_id, bucket_start, algo)
) WITHOUT ROWID;

-- The stats CLI and every later report ask "what happened in this window"
-- across all workers, which the primary key cannot serve leading-edge.
CREATE INDEX share_buckets_by_time ON share_buckets (bucket_start);
