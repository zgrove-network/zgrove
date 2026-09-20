/**
 * Stratum v1 as it is actually spoken by pools: line-delimited JSON over TCP,
 * loosely JSON-RPC 2.0 shaped but not conformant. Upstream implementations
 * disagree on the details, so everything here decodes defensively and the
 * proxy relays anything it does not need to understand.
 */

export type StratumId = number | string | null;

export interface StratumRequest {
  /** Null for notifications, which pools push without expecting an answer. */
  readonly id: StratumId;
  readonly method: string;
  readonly params: readonly unknown[];
}

/** Conventionally [code, message, data]; the data element is often omitted. */
export type StratumError = readonly [code: number, message: string, data?: unknown];

export interface StratumResponse {
  readonly id: StratumId;
  readonly result: unknown;
  readonly error: StratumError | null;
}

export type StratumMessage = StratumRequest | StratumResponse;

export const StratumMethod = {
  Subscribe: "mining.subscribe",
  Authorize: "mining.authorize",
  Submit: "mining.submit",
  Configure: "mining.configure",
  ExtranonceSubscribe: "mining.extranonce.subscribe",
  Notify: "mining.notify",
  SetDifficulty: "mining.set_difficulty",
  SetExtranonce: "mining.set_extranonce",
  Reconnect: "client.reconnect",
} as const;

export type StratumMethodName = (typeof StratumMethod)[keyof typeof StratumMethod];

/**
 * A miner that opens a socket is untrusted input. Nothing legitimate comes
 * close to this, and without a ceiling a peer that never sends a newline can
 * grow the read buffer without bound.
 */
export const MAX_STRATUM_LINE_BYTES = 64 * 1024;

export function isStratumRequest(message: StratumMessage): message is StratumRequest {
  return "method" in message;
}

export function isStratumResponse(message: StratumMessage): message is StratumResponse {
  return !("method" in message);
}

/** A request with a null id: pushed by the peer, never answered. */
export function isStratumNotification(message: StratumMessage): boolean {
  return isStratumRequest(message) && message.id === null;
}

/**
 * Upstream accepts a share by answering `true` with no error. Anything else —
 * false, null, an error tuple, a stale-share message — is a rejection.
 * Share accounting depends on this being the only definition of accepted.
 */
export function isShareAccepted(response: StratumResponse): boolean {
  return response.error === null && response.result === true;
}

export function encodeStratumMessage(message: StratumMessage): string {
  return `${JSON.stringify(message)}\n`;
}

/** Returns null for anything that is not a usable stratum message. */
export function decodeStratumLine(line: string): StratumMessage | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const id = readId(record["id"]);
  if (id === undefined) {
    return null;
  }

  const method = record["method"];
  if (typeof method === "string") {
    const params = record["params"];
    return { id, method, params: Array.isArray(params) ? params : [] };
  }

  if (!("result" in record) && !("error" in record)) {
    return null;
  }

  return {
    id,
    result: record["result"] ?? null,
    error: readError(record["error"]),
  };
}

/** Missing or explicitly null ids both mean "notification". */
function readId(value: unknown): StratumId | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "number" || typeof value === "string") {
    return value;
  }
  return undefined;
}

/** Pools that answer with a bare string or object instead of the tuple are
 * normalised here, so callers only ever branch on null vs. not-null. */
function readError(value: unknown): StratumError | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    const code = typeof value[0] === "number" ? value[0] : -1;
    const message = typeof value[1] === "string" ? value[1] : String(value[1] ?? "");
    return value.length > 2 ? [code, message, value[2]] : [code, message];
  }
  return [-1, typeof value === "string" ? value : JSON.stringify(value)];
}
