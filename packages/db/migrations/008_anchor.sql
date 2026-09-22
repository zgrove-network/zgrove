-- Where a round's commitment was written somewhere public.
--
-- A receipt fixes a round's entries under one merkle root, but the receipt is
-- a file the operator publishes, and a file can be replaced. Writing the root
-- into a Solana memo gives it a timestamp nobody here controls: a receipt that
-- later disagrees with its anchor was changed after the fact.
--
-- Nullable because a round is anchored after it is paid, and possibly never.
ALTER TABLE payout_rounds ADD COLUMN anchor_signature TEXT;
ALTER TABLE payout_rounds ADD COLUMN anchored_at INTEGER;
