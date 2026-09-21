import type { Dispatch, RecordedRound } from "@zgrove/db";

import { formatZec } from "../cli/money.js";
import type { ShieldedRecipient, Zallet } from "./zallet.js";

export interface SendPlan {
  readonly round: RecordedRound;
  readonly from: string;
  readonly recipients: readonly ShieldedRecipient[];
  readonly totalZat: number;
}

export class DispatchRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DispatchRefused";
  }
}

/**
 * Builds the send from what was recorded, and only from that. Recomputing the
 * split here would mean the amounts that go out could differ from the amounts
 * that were reviewed, with nothing in between to notice.
 */
export function planSend(round: RecordedRound, from: string): SendPlan {
  if (round.dispatchState !== "planned") {
    throw new DispatchRefused(
      `Round ${round.id} is ${round.dispatchState}, not planned. ` +
        (round.dispatchState === "sending"
          ? "A round left mid-send is not retried automatically; check the operation by hand."
          : "It has already been dealt with."),
    );
  }

  const recipients = round.entries
    .filter((entry) => entry.amountZat > 0)
    .map((entry) => ({
      address: entry.payoutAddress,
      amount: formatZec(entry.amountZat),
    }));

  if (recipients.length === 0) {
    throw new DispatchRefused(
      `Round ${round.id} pays nobody. Every account is under the minimum and carried forward.`,
    );
  }

  return {
    round,
    from,
    recipients,
    totalZat: round.entries.reduce((sum, entry) => sum + entry.amountZat, 0),
  };
}

export interface SendResult {
  readonly operationId: string;
  readonly txid: string | null;
  readonly status: string;
}

export interface SendOptions {
  /** Null lets zallet apply its own ZIP 315 confirmation policy. */
  readonly minConf: number | null;
  /** How long to wait for zcashd to finish building the proofs. */
  readonly waitMs: number;
  readonly pollMs: number;
}

/**
 * Sends one round. The order is the whole safety argument:
 *
 * 1. Claim the round with a conditional update. If it does not move from
 *    planned, someone or something else has it and this stops.
 * 2. Call z_sendmany.
 * 3. Write down the operation id the moment it comes back.
 *
 * A crash between 1 and 2 leaves the round in sending with no operation id,
 * which is the one state a human has to resolve — and it is the right place
 * to be stuck, because retrying could pay twice and shielded ZEC cannot be
 * recalled. A crash between 2 and 3 leaves the same state; the operation is
 * still in zcashd and can be found there.
 */
export async function send(
  plan: SendPlan,
  dispatch: Dispatch,
  zallet: Zallet,
  options: SendOptions,
  nowSeconds: number,
): Promise<SendResult> {
  if (!dispatch.begin(plan.round.id, plan.from, nowSeconds)) {
    throw new DispatchRefused(
      `Round ${plan.round.id} was not in planned state when the send began. Nothing was sent.`,
    );
  }

  let operationId: string;
  try {
    operationId = await zallet.sendMany(
      plan.from,
      plan.recipients,
      options.minConf,
    );
  } catch (error) {
    // The call itself failed, so nothing is in flight and the round can be
    // looked at again. Anything after this point is deliberately not
    // rolled back.
    dispatch.fail(plan.round.id);
    throw error;
  }

  dispatch.recordOperation(plan.round.id, operationId);

  const deadline = Date.now() + options.waitMs;
  for (;;) {
    const status = await zallet.operationStatus(operationId);

    if (status.status === "success" && status.txid !== null) {
      // A successful operation is not a payment. zallet builds and records
      // the transactions even when broadcasting is disabled, and reports that
      // in this field; marking the round sent on the strength of an operation
      // id would tell contributors money left when it never did.
      if (!status.broadcast) {
        dispatch.fail(plan.round.id);
        throw new Error(
          `zallet built the transactions but did not broadcast them ` +
            `(external.broadcast is off). Operation ${operationId}. Nothing was sent.`,
        );
      }

      dispatch.complete(plan.round.id, status.txid);
      return { operationId, txid: status.txid, status: status.status };
    }

    if (status.status === "failed" || status.status === "cancelled") {
      dispatch.fail(plan.round.id);
      throw new Error(
        `The send failed: ${status.error ?? status.status}. Operation ${operationId}.`,
      );
    }

    if (Date.now() > deadline) {
      // Still building. Left in sending on purpose — the operation is real
      // and the id is recorded, so this is resumable rather than lost.
      return { operationId, txid: null, status: status.status };
    }

    await new Promise((resolve) => setTimeout(resolve, options.pollMs));
  }
}

/** Finishes a round whose operation was still running when we last looked. */
export async function resume(
  round: RecordedRound,
  dispatch: Dispatch,
  zallet: Zallet,
): Promise<SendResult> {
  if (round.dispatchState !== "sending") {
    throw new DispatchRefused(`Round ${round.id} is ${round.dispatchState}, not sending.`);
  }
  if (round.operationId === null) {
    throw new DispatchRefused(
      `Round ${round.id} has no operation id. It stopped between claiming the round and hearing back ` +
        `from zcashd, so whether anything was sent has to be established by hand — z_listoperationids ` +
        `and the wallet's transactions are the place to look. This will not retry on its own.`,
    );
  }

  const status = await zallet.operationStatus(round.operationId);
  if (status.status === "success" && status.txid !== null && status.broadcast) {
    dispatch.complete(round.id, status.txid);
  } else if (status.status === "failed" || status.status === "cancelled") {
    dispatch.fail(round.id);
  }

  return { operationId: round.operationId, txid: status.txid, status: status.status };
}
