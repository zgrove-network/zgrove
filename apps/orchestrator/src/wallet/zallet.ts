export interface ZalletOptions {
  readonly url: string;
  readonly user: string;
  readonly password: string;
  readonly timeoutMs: number;
}

export interface ShieldedRecipient {
  readonly address: string;
  /** Decimal ZEC, which is what the RPC takes. Built from integer zatoshi. */
  readonly amount: string;
}

export class ZalletError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(`zallet: ${message} (code ${code})`);
    this.name = "ZalletError";
  }
}

export interface OperationStatus {
  readonly status: "queued" | "executing" | "success" | "failed" | "cancelled";
  /** Present on success. With several transactions, only `txids` is set. */
  readonly txid: string | null;
  readonly txids: readonly string[];
  /**
   * Whether zallet actually put the transactions on the network. False when
   * `external.broadcast` is off, in which case they were built and recorded
   * in the wallet and never sent. A successful operation is NOT a payment.
   */
  readonly broadcast: boolean;
  readonly error: string | null;
}

/**
 * The narrow slice of zallet's RPC this needs. Deliberately small: a wallet
 * client able to do more than send and enquire is one that can be called by
 * mistake in more ways.
 *
 * zcashd reached its end-of-support halt at block 3417100 on 2026-07-18 and
 * refuses to start, so the target is zebrad for the chain and zallet for the
 * wallet. Where the two RPCs differ, the differences are handled here rather
 * than leaking into the dispatch logic.
 */
export interface Zallet {
  /** Returns an operation id; the send completes asynchronously. */
  sendMany(
    from: string,
    recipients: readonly ShieldedRecipient[],
    minConf: number | null,
  ): Promise<string>;
  operationStatus(operationId: string): Promise<OperationStatus>;
  balanceForAccount(account: string, minConf: number): Promise<unknown>;
}

export function createZallet(options: ZalletOptions): Zallet {
  async function call(method: string, params: readonly unknown[]): Promise<unknown> {
    const response = await fetch(options.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization:
          "Basic " +
          Buffer.from(`${options.user}:${options.password}`).toString("base64"),
      },
      body: JSON.stringify({ jsonrpc: "1.0", id: "zgrove", method, params }),
      signal: AbortSignal.timeout(options.timeoutMs),
    });

    const body = (await response.json().catch(() => null)) as {
      result?: unknown;
      error?: { code?: number; message?: string } | null;
    } | null;

    if (body === null) {
      throw new Error(`zallet returned no JSON for ${method}`);
    }
    if (body.error !== null && body.error !== undefined) {
      throw new ZalletError(body.error.code ?? -1, body.error.message ?? "unknown");
    }
    return body.result;
  }

  return {
    async sendMany(from, recipients, minConf) {
      // No fee argument. zallet requires it to be null when present because
      // ZIP 317 fees are always used, so the only correct call omits it.
      const params: unknown[] = [from, recipients];
      if (minConf !== null) {
        params.push(minConf);
      }

      const result = await call("z_sendmany", params);
      if (typeof result !== "string") {
        throw new Error("z_sendmany did not return an operation id");
      }
      return result;
    },

    async operationStatus(operationId) {
      const result = await call("z_getoperationstatus", [[operationId]]);
      const entry = Array.isArray(result) ? result[0] : undefined;
      if (typeof entry !== "object" || entry === null) {
        throw new Error(`No such operation: ${operationId}`);
      }

      const record = entry as Record<string, unknown>;
      const status = record["status"];
      const inner = record["result"] as Record<string, unknown> | undefined;
      const failure = record["error"] as Record<string, unknown> | undefined;

      const txids = Array.isArray(inner?.["txids"])
        ? (inner["txids"] as unknown[]).filter(
            (id): id is string => typeof id === "string",
          )
        : [];
      const single = typeof inner?.["txid"] === "string" ? (inner["txid"] as string) : null;

      return {
        status:
          typeof status === "string"
            ? (status as OperationStatus["status"])
            : "failed",
        txid: single ?? txids[0] ?? null,
        txids: single === null ? txids : [single, ...txids.filter((id) => id !== single)],
        // Absent means an older or differently configured wallet. Treating a
        // missing field as "broadcast" keeps a correctly configured zallet
        // working; a wallet with broadcasting off reports it explicitly.
        broadcast: record["broadcast"] !== false && inner?.["broadcast"] !== false,
        error:
          typeof failure?.["message"] === "string"
            ? (failure["message"] as string)
            : null,
      };
    },

    async balanceForAccount(account, minConf) {
      // z_getbalance is omitted in zallet; balances are account-scoped now.
      return call("z_getbalanceforaccount", [account, minConf]);
    },
  };
}
