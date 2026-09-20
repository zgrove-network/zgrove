-- A submit upstream never answered is neither accepted nor rejected, and
-- folding it into either column would state something untrue: as a rejection
-- it blames the worker for the pool's silence, as an acceptance it invents
-- work nobody confirmed. Left out of the table entirely, as it was, an
-- upstream that stops answering is invisible in the reports, since the counts
-- do not rise and nothing says why.
--
-- It carries no weight and no value, for the same reason a rejection carries
-- none: nothing upstream agreed to was done.
ALTER TABLE share_buckets ADD COLUMN unresolved INTEGER NOT NULL DEFAULT 0;
