-- Sending state, per round.
--
-- A round is paid by one z_sendmany with many shielded recipients rather than
-- one transaction each. That is cheaper, but the reason is privacy: separate
-- transactions correlate by timing and by amount, while a single transaction
-- reveals only how many outputs it has. Who received what stays inside the
-- shielded pool either way; the batching removes the side channel around it.
--
-- 'sending' exists so a crash between the RPC call and its answer is
-- recoverable. A round found in 'sending' on start is NOT retried: there is no
-- way to ask the network whether a shielded send landed without the operation
-- id, and there is no way to take ZEC back. It is surfaced for a human.
ALTER TABLE payout_rounds ADD COLUMN dispatch_state TEXT NOT NULL DEFAULT 'planned'
  CHECK (dispatch_state IN ('planned', 'sending', 'sent', 'failed'));

-- zcashd answers z_sendmany with an operation id and completes it later, so
-- the id is what links a round to a transaction that may not exist yet.
ALTER TABLE payout_rounds ADD COLUMN operation_id TEXT;
ALTER TABLE payout_rounds ADD COLUMN txid TEXT;
ALTER TABLE payout_rounds ADD COLUMN dispatched_at INTEGER;

-- The address money actually left from. Recorded because a treasury with more
-- than one source address would otherwise leave no trace of which one paid.
ALTER TABLE payout_rounds ADD COLUMN from_address TEXT;
