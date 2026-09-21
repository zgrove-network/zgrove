export interface ZcashdOptions {
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

export class ZcashdError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(`zcashd: ${message} (code ${code})`);
    this.name = "ZcashdError";
  }
}

export interface OperationStatus {
  readonly status: "queued" | "executing" | "success" | "failed" | "cancelled";
  readonly txid: string | null;
  readonly error: string | null;
}

/**
 * The narrow slice of zcashd's RPC this needs. Deliberately small: a wallet
 * client able to do more than send and enquire is one that can be called by
 * mistake in more ways.
 */
export interface Zcashd {
  /** Returns an operation id; the send itself completes asynchronously. */
  sendMany(
    from: string,
    recipients: readonly ShieldedRecipient[],
    minConf: number,
    fee: string | null,
  ): Promise<string>;
  operationStatus(operationId: string): Promise<OperationStatus>;
  balance(address: string, minConf: number): Promise<string>;
}

export function createZcashd(options: ZcashdOptions): Zcashd {
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
      throw new Error(`zcashd returned no JSON for ${method}`);
    }
    if (body.error !== null && body.error !== undefined) {
      throw new ZcashdError(body.error.code ?? -1, body.error.message ?? "unknown");
    }
    return body.result;
  }

  return {
    async sendMany(from, recipients, minConf, fee) {
      // z_sendmany is asynchronous because building shielded outputs takes
      // real proving time. The operation id it returns is the only handle on
      // a send in flight, which is why the caller writes it down first.
      const params: unknown[] = [from, recipients, minConf];
      if (fee !== null) {
        params.push(fee);
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

      return {
        status:
          typeof status === "string"
            ? (status as OperationStatus["status"])
            : "failed",
        txid: typeof inner?.["txid"] === "string" ? (inner["txid"] as string) : null,
        error:
          typeof failure?.["message"] === "string"
            ? (failure["message"] as string)
            : null,
      };
    },

    async balance(address, minConf) {
      return String(await call("z_getbalance", [address, minConf]));
    },
  };
}
