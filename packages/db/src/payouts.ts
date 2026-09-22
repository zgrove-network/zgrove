import { BUCKET_SECONDS } from "./buckets.js";
import type { Db } from "./database.js";

/**
 * Money is integer zatoshi throughout. Zcash's whole supply is 21e6 ZEC, or
 * 2.1e15 zatoshi, which sits inside the 2^53 a JS number holds exactly, so
 * these arithmetic paths are safe without BigInt. The guard below keeps that
 * true rather than assuming it.
 */
const MAX_SAFE_ZAT = Number.MAX_SAFE_INTEGER;

export interface RoundRequest {
  readonly periodStart: number;
  /** Exclusive, so consecutive rounds cannot overlap or skip a bucket. */
  readonly periodEnd: number;
  /** What the treasury holds for this window, in zatoshi. */
  readonly totalZat: number;
  /**
   * The fee an account pays, in basis points. Called once per account, so a
   * staked contributor and an unstaked one can be charged differently in the
   * same round.
   */
  readonly feeBpsFor: (accountId: string) => number;
  /** Below this, an account is carried forward rather than paid dust. */
  readonly minPayoutZat: number;
  readonly atSeconds: number;
}

export interface PlannedEntry {
  readonly accountId: string;
  readonly payoutAddress: string;
  readonly weight: number;
  /** Before fee, from weight alone. */
  readonly grossZat: number;
  readonly feeBps: number;
  readonly feeZat: number;
  readonly carriedInZat: number;
  readonly amountZat: number;
  readonly carriedOutZat: number;
}

export interface PlannedRound {
  readonly periodStart: number;
  readonly periodEnd: number;
  readonly totalZat: number;
  /** The sum of what every account was charged. */
  readonly feeZat: number;
  readonly distributableZat: number;
  readonly totalWeight: number;
  readonly entries: readonly PlannedEntry[];
}

export interface Payouts {
  /** Computes a round. Writes nothing. */
  plan(request: RoundRequest): PlannedRound;
  /** Records a computed round as planned. Refuses a period already recorded. */
  record(round: PlannedRound, atSeconds: number): number;
  carriedForward(accountId: string): number;
}

interface SubjectRow {
  readonly account_id: string;
  readonly payout_address: string;
  readonly weight: number;
  /** Owed from earlier rounds and not yet paid. */
  readonly carried: number;
}

export function createPayouts(db: Db): Payouts {
  // Weight is accepted share difficulty, summed per account across all the
  // rigs it owns. Rejected and unanswered shares carry none, which is decided
  // where the share is written rather than here.
  //
  // An account is in the round when it earned in this window OR when it is
  // still owed something from an earlier one. Selecting on work alone would
  // strand a contributor who fell under the minimum and then stopped mining:
  // their balance would sit in carry with nothing left to ever pay it out.
  const subjects = db.prepare<[number, number], SubjectRow>(`
    SELECT a.id                                 AS account_id,
           a.payout_address                     AS payout_address,
           COALESCE(SUM(b.accepted_difficulty), 0) AS weight,
           COALESCE((
             SELECT SUM(e.carried_out_zat) - SUM(e.carried_in_zat)
             FROM payout_entries e
             WHERE e.account_id = a.id
           ), 0)                                AS carried
    FROM accounts a
    LEFT JOIN workers w ON w.username = a.id
    LEFT JOIN share_buckets b
      ON b.worker_id = w.id
     AND b.bucket_start >= ?
     AND b.bucket_start <  ?
    GROUP BY a.id
    HAVING weight > 0 OR carried != 0
    ORDER BY a.id
  `);

  const carryFor = db.prepare<[string], { carried: number }>(`
    SELECT COALESCE(SUM(carried_out_zat) - SUM(carried_in_zat), 0) AS carried
    FROM payout_entries
    WHERE account_id = ?
  `);

  const insertRound = db.prepare<
    [number, number, number, string, number, number, number],
    { id: number }
  >(`
    INSERT INTO payout_rounds
      (period_start, period_end, created_at, state, fee_bps, total_zat, total_weight)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `);

  const insertEntry = db.prepare(`
    INSERT INTO payout_entries
      (round_id, account_id, weight, carried_in_zat, amount_zat, carried_out_zat,
       payout_address, fee_bps, fee_zat)
    VALUES (@roundId, @accountId, @weight, @carriedIn, @amount, @carriedOut,
            @address, @feeBps, @fee)
  `);

  return {
    plan(request) {
      guardAmount(request.totalZat, "totalZat");
      if (request.periodEnd <= request.periodStart) {
        throw new Error("A payout period must end after it starts");
      }

      // Shares are stored as five-minute buckets, and a bucket is matched by
      // its start second. A window that begins or ends mid-bucket therefore
      // drops that bucket whole, silently, in the code that decides what
      // people are paid. Refusing the window is the only safe answer: there
      // is no rounding of it that does not either lose work or pay for the
      // same work twice across two rounds.
      if (
        request.periodStart % BUCKET_SECONDS !== 0 ||
        request.periodEnd % BUCKET_SECONDS !== 0
      ) {
        throw new Error(
          `A payout period must align to ${BUCKET_SECONDS}-second bucket boundaries`,
        );
      }

      const rows = subjects.all(request.periodStart, request.periodEnd);
      const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);

      // Money with no work behind it has nobody to go to, and splitting it by
      // a zero total weight would silently leave it unattributed. A round in
      // that state is a mistake — the wrong window, or the wrong total — and
      // saying so beats swallowing the amount. A round of nothing but carried
      // balances is still legitimate, so only a non-zero total is refused.
      if (request.totalZat > 0 && totalWeight <= 0) {
        throw new Error(
          "This window has a total to pay out but no accepted work to pay it to",
        );
      }

      // The whole total is split by weight first, and each account's own fee
      // comes out of its own share. One fee off the top would charge every
      // contributor the same rate, which is the thing tiers exist to stop.
      const gross = splitByWeight(
        request.totalZat,
        rows.map((row) => row.weight),
        totalWeight,
      );

      let feeZat = 0;
      const entries: PlannedEntry[] = rows.map((row, index) => {
        const grossZat = gross[index] ?? 0;
        const feeBps = readFeeBps(request.feeBpsFor(row.account_id), row.account_id);

        // Floored, so the odd zatoshi of rounding stays with the contributor
        // rather than the pool.
        const entryFee = Math.floor((grossZat * feeBps) / 10_000);
        feeZat += entryFee;

        const carriedIn = row.carried;
        const owed = grossZat - entryFee + carriedIn;
        const pays = owed >= request.minPayoutZat && owed > 0;

        return {
          accountId: row.account_id,
          payoutAddress: row.payout_address,
          weight: row.weight,
          grossZat,
          feeBps,
          feeZat: entryFee,
          carriedInZat: carriedIn,
          amountZat: pays ? owed : 0,
          carriedOutZat: pays ? 0 : owed,
        };
      });

      return {
        periodStart: request.periodStart,
        periodEnd: request.periodEnd,
        totalZat: request.totalZat,
        feeZat,
        distributableZat: request.totalZat - feeZat,
        totalWeight,
        entries,
      };
    },

    record(round, atSeconds) {
      const write = db.transaction((): number => {
        const created = insertRound.get(
          round.periodStart,
          round.periodEnd,
          atSeconds,
          "planned",
          feeBpsOf(round),
          round.totalZat,
          round.totalWeight,
        );
        if (created === undefined) {
          throw new Error("Round insert returned no row");
        }

        for (const entry of round.entries) {
          insertEntry.run({
            roundId: created.id,
            accountId: entry.accountId,
            weight: entry.weight,
            carriedIn: entry.carriedInZat,
            amount: entry.amountZat,
            carriedOut: entry.carriedOutZat,
            address: entry.payoutAddress,
            feeBps: entry.feeBps,
            fee: entry.feeZat,
          });
        }
        return created.id;
      });

      return write();
    },

    carriedForward(accountId) {
      return carryFor.get(accountId)?.carried ?? 0;
    },
  };
}

/**
 * Splits an integer total across weights so the parts sum to exactly the
 * whole. Flooring alone loses up to one zatoshi per account; the leftover is
 * handed out one at a time to the largest fractional remainders, which is the
 * least arbitrary rule that still conserves the total.
 */
export function splitByWeight(
  total: number,
  weights: readonly number[],
  totalWeight: number,
): number[] {
  if (weights.length === 0 || totalWeight <= 0 || total <= 0) {
    return weights.map(() => 0);
  }

  const exact = weights.map((weight) => (total * weight) / totalWeight);
  const floors = exact.map((value) => Math.floor(value));
  let leftover = total - floors.reduce((sum, value) => sum + value, 0);

  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  for (const { index } of order) {
    if (leftover <= 0) {
      break;
    }
    floors[index] = (floors[index] ?? 0) + 1;
    leftover -= 1;
  }

  return floors;
}

/** The round-level rate is the effective average; per-account rates are on
 * the entries, which is where a contributor checks their own. */
function feeBpsOf(round: PlannedRound): number {
  return round.totalZat === 0
    ? 0
    : Math.round((round.feeZat / round.totalZat) * 10_000);
}

function readFeeBps(value: number, accountId: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new Error(
      `Fee for ${accountId} must be an integer 0-10000 basis points, got ${value}`,
    );
  }
  return value;
}

function guardAmount(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_SAFE_ZAT) {
    throw new Error(`${name} must be a non-negative integer of zatoshi`);
  }
}

export type DispatchState = "planned" | "sending" | "sent" | "failed";

export interface RecordedRound {
  readonly id: number;
  readonly periodStart: number;
  readonly periodEnd: number;
  readonly totalZat: number;
  readonly totalWeight: number;
  readonly dispatchState: DispatchState;
  readonly operationId: string | null;
  readonly txid: string | null;
  readonly fromAddress: string | null;
  /** How the money left: through this process, or by hand. */
  readonly settlement: "wallet" | "external" | null;
  /** The Solana transaction carrying this round's commitment, once written. */
  readonly anchorSignature: string | null;
  readonly entries: readonly RecordedEntry[];
}

export interface RecordedEntry {
  readonly accountId: string;
  readonly payoutAddress: string;
  readonly amountZat: number;
  readonly carriedOutZat: number;
}

export interface Dispatch {
  load(roundId: number): RecordedRound | null;
  /**
   * Moves a round from planned to sending, or returns false. Conditional in
   * the UPDATE itself, so two processes cannot both believe they won it.
   */
  begin(roundId: number, fromAddress: string, atSeconds: number): boolean;
  recordOperation(roundId: number, operationId: string): void;
  complete(roundId: number, txid: string, settlement?: "wallet" | "external"): void;
  /** Records a payment made outside this process, after it was verified. */
  settleExternally(roundId: number, txid: string, atSeconds: number): boolean;
  /**
   * Records where the commitment was published, or returns false. Only a sent
   * round, and only once: conditional in the UPDATE, so a second anchor cannot
   * quietly replace the first.
   */
  recordAnchor(roundId: number, signature: string, atSeconds: number): boolean;
  fail(roundId: number): void;
}

export function createDispatch(db: Db): Dispatch {
  const selectRound = db.prepare<[number], RoundRow>(`
    SELECT id, period_start, period_end, total_zat, total_weight,
           dispatch_state, operation_id, txid, from_address, settlement,
           anchor_signature
    FROM payout_rounds WHERE id = ?
  `);

  const selectEntries = db.prepare<[number], EntryRow>(`
    SELECT account_id, payout_address, amount_zat, carried_out_zat
    FROM payout_entries WHERE round_id = ? ORDER BY account_id
  `);

  // The guard against paying a round twice. A round already sending, sent or
  // failed does not match, so the update changes nothing and the caller is
  // told it did not win rather than proceeding on an assumption.
  const setAnchor = db.prepare(`
    UPDATE payout_rounds
    SET anchor_signature = ?, anchored_at = ?
    WHERE id = ? AND dispatch_state = 'sent' AND anchor_signature IS NULL
  `);

  const beginSend = db.prepare(`
    UPDATE payout_rounds
    SET dispatch_state = 'sending', from_address = ?, dispatched_at = ?
    WHERE id = ? AND dispatch_state = 'planned'
  `);

  const setOperation = db.prepare(
    "UPDATE payout_rounds SET operation_id = ? WHERE id = ?",
  );
  const setSent = db.prepare(
    "UPDATE payout_rounds SET dispatch_state = 'sent', txid = ?, state = 'sent', settlement = ? WHERE id = ?",
  );

  // Conditional on the round still being planned, for the same reason the
  // wallet path is: a round settled twice is a round paid twice, and the
  // second payment is as unrecallable as the first.
  const setExternal = db.prepare(`
    UPDATE payout_rounds
    SET dispatch_state = 'sent', state = 'sent', settlement = 'external',
        txid = ?, dispatched_at = ?
    WHERE id = ? AND dispatch_state = 'planned'
  `);
  const setFailed = db.prepare(
    "UPDATE payout_rounds SET dispatch_state = 'failed' WHERE id = ?",
  );

  return {
    load(roundId) {
      const row = selectRound.get(roundId);
      if (row === undefined) {
        return null;
      }

      return {
        id: row.id,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        totalZat: row.total_zat,
        totalWeight: row.total_weight,
        dispatchState: row.dispatch_state,
        operationId: row.operation_id,
        txid: row.txid,
        fromAddress: row.from_address,
        settlement: row.settlement,
        anchorSignature: row.anchor_signature,
        entries: selectEntries.all(roundId).map((entry) => ({
          accountId: entry.account_id,
          payoutAddress: entry.payout_address,
          amountZat: entry.amount_zat,
          carriedOutZat: entry.carried_out_zat,
        })),
      };
    },

    begin(roundId, fromAddress, atSeconds) {
      return beginSend.run(fromAddress, atSeconds, roundId).changes === 1;
    },

    recordOperation(roundId, operationId) {
      setOperation.run(operationId, roundId);
    },

    complete(roundId, txid, settlement = "wallet") {
      setSent.run(txid, settlement, roundId);
    },

    settleExternally(roundId, txid, atSeconds) {
      return setExternal.run(txid, atSeconds, roundId).changes === 1;
    },

    recordAnchor(roundId, signature, atSeconds) {
      return setAnchor.run(signature, atSeconds, roundId).changes === 1;
    },

    fail(roundId) {
      setFailed.run(roundId);
    },
  };
}

interface RoundRow {
  readonly id: number;
  readonly period_start: number;
  readonly period_end: number;
  readonly total_zat: number;
  readonly total_weight: number;
  readonly dispatch_state: DispatchState;
  readonly operation_id: string | null;
  readonly txid: string | null;
  readonly from_address: string | null;
  readonly settlement: "wallet" | "external" | null;
  readonly anchor_signature: string | null;
}

interface EntryRow {
  readonly account_id: string;
  readonly payout_address: string;
  readonly amount_zat: number;
  readonly carried_out_zat: number;
}
