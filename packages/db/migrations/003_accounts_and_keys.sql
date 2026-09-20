-- A contributor, and the shielded address their earnings go to.
--
-- Until now the payout address WAS the stratum login, which meant it crossed
-- the wire in cleartext on every authorize and every share, to us and to
-- anything on the path. Here it is a row nobody has to send, and the wire
-- carries a short-lived token instead.
--
-- The address is stored as given. Validating a Zcash address needs bech32m and
-- belongs with the code that is about to send money to it, not with the code
-- that writes it down.
CREATE TABLE accounts (
  id             TEXT    PRIMARY KEY,
  payout_address TEXT    NOT NULL,
  created_at     INTEGER NOT NULL
);

-- One row per rig: the public key it proves itself with, the account it earns
-- for, and the worker row its shares are attributed to.
--
-- The key is the primary key, so a key is bound to exactly one account for as
-- long as it exists. Rebinding is not an update anyone can make by accident;
-- it takes deleting the row, which is the point. A key that could move between
-- accounts would move the work already recorded under it too.
CREATE TABLE worker_keys (
  public_key    TEXT    PRIMARY KEY,
  account_id    TEXT    NOT NULL REFERENCES accounts (id),
  worker_id     INTEGER NOT NULL REFERENCES workers (id),
  registered_at INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);

CREATE INDEX worker_keys_by_account ON worker_keys (account_id);
