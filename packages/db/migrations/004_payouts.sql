-- A payout round: one window of work, priced once, paid once.
--
-- The window is unique, which is the whole safety property of this table. A
-- round that could be planned twice for the same period could be paid twice,
-- and there is no way to take ZEC back out of a shielded address.
--
-- total_zat is what the treasury actually holds for this window, supplied by
-- whoever converted the upstream coin. Share weight decides how it is split;
-- it does not decide how much there is.
CREATE TABLE payout_rounds (
  id           INTEGER PRIMARY KEY,
  period_start INTEGER NOT NULL,
  period_end   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  -- planned: computed, nothing sent. sent: money has moved.
  state        TEXT    NOT NULL CHECK (state IN ('planned', 'sent')),
  fee_bps      INTEGER NOT NULL,
  total_zat    INTEGER NOT NULL,
  total_weight REAL    NOT NULL,
  UNIQUE (period_start, period_end)
);

-- What one account is owed for one round.
--
-- amount_zat is what gets sent. carried_out_zat is what was owed but sat
-- under the minimum and rolls into the next round instead of being paid as
-- dust or, worse, dropped. carried_in_zat is what rolled in from before.
--
-- The invariant every round has to satisfy:
--   sum(amount_zat) + sum(carried_out_zat) = distributable + sum(carried_in_zat)
-- Nothing is created and nothing is lost in the split.
CREATE TABLE payout_entries (
  round_id        INTEGER NOT NULL REFERENCES payout_rounds (id),
  account_id      TEXT    NOT NULL REFERENCES accounts (id),
  weight          REAL    NOT NULL,
  carried_in_zat  INTEGER NOT NULL DEFAULT 0,
  amount_zat      INTEGER NOT NULL DEFAULT 0,
  carried_out_zat INTEGER NOT NULL DEFAULT 0,
  -- Copied in at plan time. An address changed between planning and sending
  -- would otherwise silently redirect a payment nobody re-approved.
  payout_address  TEXT    NOT NULL,
  txid            TEXT,
  PRIMARY KEY (round_id, account_id)
) WITHOUT ROWID;

CREATE INDEX payout_entries_by_account ON payout_entries (account_id);
