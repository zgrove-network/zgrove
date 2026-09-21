-- How a round's money actually left.
--
-- 'wallet' is a send this process made through zallet and watched complete.
-- 'external' is one an operator made by hand and then recorded, which is the
-- only way to pay a round without a synced node — and the distinction is kept
-- because a receipt should not present the two as the same evidence. An
-- external settlement rests on a transaction id checked against the chain;
-- a wallet settlement rests on the operation this process ran.
ALTER TABLE payout_rounds ADD COLUMN settlement TEXT;
