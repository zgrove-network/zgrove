-- The Solana wallet an account's fee tier is read from.
--
-- Bound by signature, never by assertion: a stake that can be claimed by
-- typing somebody else's address is a discount anyone can take. The binding
-- lives on the account rather than on the payout address, so what an observer
-- can infer from the public stake is "this person mines here" and not "this
-- person earned that".
ALTER TABLE accounts ADD COLUMN solana_address TEXT;
ALTER TABLE accounts ADD COLUMN solana_bound_at INTEGER;

-- What each account was actually charged, per round.
--
-- The rate is no longer one number for the whole round, so recording it per
-- entry is the only way a contributor can check the tier they were given
-- against the tier they hold. A single round-level fee_bps would average away
-- exactly the thing they would want to verify.
ALTER TABLE payout_entries ADD COLUMN fee_bps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payout_entries ADD COLUMN fee_zat INTEGER NOT NULL DEFAULT 0;
