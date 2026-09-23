import { connect, constants, type ClientHttp2Session } from "node:http2";

import { ExplorerUnavailable, type TransactionFacts } from "./chain.js";

/**
 * Looks a transaction up through lightwalletd, the service every Zcash light
 * wallet already talks to.
 *
 * The reason is Orchard. No explorer decodes that bundle, so whether a payment
 * was shielded had to be inferred from fields they had simply left out — an
 * inference that refused real payments until it was caught. lightwalletd hands
 * over the raw transaction, so the question is answered from the transaction
 * itself rather than from what somebody's parser omitted.
 *
 * Reliability is the second reason. Blockchair rate-limits hard and sometimes
 * refuses outright, at the TLS handshake, from no particular address; an
 * earlier note here called that a datacenter ban, which a later check did not
 * bear out. Either way it is not a service to make a payout depend on.
 *
 * It speaks gRPC, which is HTTP/2 carrying length-prefixed protobuf. One method
 * with two small messages does not justify a gRPC library inside the process
 * that holds the payout records, so both are written out here.
 */

const SERVICE = "/cash.z.wallet.sdk.rpc.CompactTxStreamer/GetTransaction";

export const DEFAULT_LIGHTWALLETD = "zec.rocks:443";

export interface LightwalletdOptions {
  /** Host and port, e.g. "zec.rocks:443". */
  readonly endpoint: string;
  readonly timeoutMs: number;
}

/**
 * What a gRPC call came back with. The status is reported in a header or a
 * trailer and never in the body, so it is carried separately: a server that
 * fails answers with an empty body and a status, which is byte-for-byte what a
 * successful lookup of a transaction that does not exist also looks like.
 */
export interface GrpcAnswer {
  /** "0" when the call succeeded. */
  readonly status: string;
  readonly message: string;
  readonly body: Uint8Array;
}

export type GrpcCall = (
  options: LightwalletdOptions,
  path: string,
  message: Uint8Array,
) => Promise<GrpcAnswer>;

/* ---------------------------------------------------------------- protobuf */

function varint(n: number): number[] {
  const out: number[] = [];
  let rest = n;
  do {
    const low = rest & 0x7f;
    rest >>>= 7;
    out.push(rest === 0 ? low : low | 0x80);
  } while (rest !== 0);
  return out;
}

function readVarint(buf: Uint8Array, at: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let i = at;
  for (;;) {
    const b = buf[i];
    if (b === undefined) throw new ExplorerUnavailable("the answer stopped mid-number");
    i += 1;
    value += (b & 0x7f) * 2 ** shift;
    if ((b & 0x80) === 0) return { value, next: i };
    shift += 7;
  }
}

/**
 * TxFilter { bytes hash = 3; }
 *
 * A txid is displayed as its internal hash reversed, and the wire wants the
 * internal order. Sending it the way it is written asks about a transaction
 * that does not exist, and the answer to that is indistinguishable from a
 * payment that was never made.
 */
export function txFilter(txid: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(txid)) {
    throw new Error("A Zcash transaction id is 64 hex characters");
  }
  const hash = Uint8Array.from(
    (txid.match(/../g) ?? []).map((byte) => Number.parseInt(byte, 16)),
  ).reverse();
  return Uint8Array.from([(3 << 3) | 2, ...varint(hash.length), ...hash]);
}

/** RawTransaction { bytes data = 1; uint64 height = 2; } */
function decodeRawTransaction(body: Uint8Array): { data: Uint8Array; height: number } {
  let data = new Uint8Array();
  let height = 0;
  let at = 0;

  while (at < body.length) {
    const key = readVarint(body, at);
    at = key.next;
    const field = key.value >> 3;

    switch (key.value & 7) {
      case 2: {
        const length = readVarint(body, at);
        at = length.next;
        if (field === 1) data = Uint8Array.from(body.subarray(at, at + length.value));
        at += length.value;
        break;
      }
      case 0: {
        const value = readVarint(body, at);
        at = value.next;
        if (field === 2) height = value.value;
        break;
      }
      // Nothing in this message is fixed-width, so anything else means the
      // bytes are not the message they are supposed to be.
      default:
        throw new ExplorerUnavailable("the answer was not a transaction");
    }
  }

  return { data, height };
}

/* ------------------------------------------------------------ transactions */

function compactSize(tx: Uint8Array, at: number): number {
  const first = tx[at];
  if (first === undefined) throw new ExplorerUnavailable("the transaction was cut short");
  if (first < 0xfd) return first;
  if (first === 0xfd) return (tx[at + 1] ?? 0) | ((tx[at + 2] ?? 0) << 8);
  throw new ExplorerUnavailable("the transaction claims an implausible input count");
}

/**
 * Whether a transaction spends anything transparent, read from the raw bytes.
 *
 * A transaction that is not a coinbase has to spend something, so one with no
 * transparent inputs spent from a shielded pool — whichever pool that is. That
 * stays true through Sapling, Orchard and Ironwood, because it never looks
 * inside the bundle, which is exactly where the explorers failed. A coinbase
 * always carries one input, so a count of zero excludes it too.
 *
 * The count sits at a different offset either side of NU5. Before Overwinter
 * there is no version group at all, but such a transaction is from 2018 or
 * earlier and cannot be a payout this pool made, so it is refused rather than
 * guessed at.
 */
export function spendsNothingTransparent(tx: Uint8Array): boolean {
  if (tx.length < 4) throw new ExplorerUnavailable("the transaction was cut short");
  const header =
    (tx[0] ?? 0) | ((tx[1] ?? 0) << 8) | ((tx[2] ?? 0) << 16) | ((tx[3] ?? 0) << 24);
  const version = header & 0x7fffffff;

  if ((header & 0x80000000) === 0) {
    throw new ExplorerUnavailable(
      "the transaction predates Overwinter, so it cannot be a payout from this pool",
    );
  }

  // v5 and later: header, version group, consensus branch, lock time, expiry.
  // v3 and v4: header and version group.
  return compactSize(tx, version >= 5 ? 20 : 8) === 0;
}

/* ------------------------------------------------------------------- gRPC */

/**
 * Reads one answer as facts about a transaction.
 *
 * Status 5 is NOT_FOUND: the server answered, and its answer is that there is
 * no such transaction. Every other non-zero status is the server failing, and
 * is kept apart, because reported as not-found it reads as "your payment never
 * happened" and the obvious response to that is to send it again.
 */
export function readAnswer(answer: GrpcAnswer): TransactionFacts {
  const absent: TransactionFacts = { exists: false, blockHeight: null, shielded: false };

  if (answer.status === "5") return absent;
  if (answer.status !== "0") {
    throw new ExplorerUnavailable(
      `grpc status ${answer.status}${answer.message === "" ? "" : `: ${answer.message}`}`,
    );
  }

  const { body } = answer;
  if (body.length < 5) throw new ExplorerUnavailable("the answer was empty");
  if (body[0] !== 0) throw new ExplorerUnavailable("the answer was compressed");

  const framed = (body[1] ?? 0) * 2 ** 24 + ((body[2] ?? 0) << 16) + ((body[3] ?? 0) << 8) + (body[4] ?? 0);
  if (framed > body.length - 5) throw new ExplorerUnavailable("the answer was cut short");

  const { data, height } = decodeRawTransaction(body.subarray(5, 5 + framed));

  // Some servers report a missing transaction as an empty success rather than
  // as NOT_FOUND.
  if (data.length === 0) return absent;

  return {
    exists: true,
    // Zero means it is in the mempool and not in a block yet.
    blockHeight: height > 0 ? height : null,
    shielded: spendsNothingTransparent(data),
  };
}

/** One unary gRPC call over HTTP/2. */
export const grpcCall: GrpcCall = (options, path, message) => {
  const [host] = options.endpoint.split(":");

  return new Promise((resolve, reject) => {
    let session: ClientHttp2Session;
    try {
      session = connect(`https://${options.endpoint}`, { servername: host });
    } catch (cause) {
      reject(new ExplorerUnavailable(cause instanceof Error ? cause.message : "connect failed"));
      return;
    }

    let settled = false;
    const done = (finish: () => void) => {
      if (settled) return;
      settled = true;
      session.close();
      finish();
    };

    session.on("error", (error) => done(() => reject(new ExplorerUnavailable(error.message))));
    session.setTimeout(options.timeoutMs, () =>
      done(() => reject(new ExplorerUnavailable("timed out"))),
    );

    const frame = Uint8Array.from([
      0,
      (message.length >>> 24) & 0xff,
      (message.length >>> 16) & 0xff,
      (message.length >>> 8) & 0xff,
      message.length & 0xff,
      ...message,
    ]);

    const request = session.request({
      [constants.HTTP2_HEADER_METHOD]: "POST",
      [constants.HTTP2_HEADER_PATH]: path,
      "content-type": "application/grpc+proto",
      te: "trailers",
    });

    let status = "0";
    let statusMessage = "";
    const note = (headers: Record<string, unknown>) => {
      if (headers["grpc-status"] !== undefined) status = String(headers["grpc-status"]);
      if (headers["grpc-message"] !== undefined) statusMessage = String(headers["grpc-message"]);
    };
    request.on("response", (headers) => note(headers as Record<string, unknown>));
    request.on("trailers", (headers) => note(headers as Record<string, unknown>));

    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", (error) => done(() => reject(new ExplorerUnavailable(error.message))));
    request.on("end", () =>
      done(() =>
        resolve({
          status,
          message: statusMessage,
          body: Uint8Array.from(Buffer.concat(chunks)),
        }),
      ),
    );

    request.end(frame);
  });
};

export function createLightwalletdLookup(options: LightwalletdOptions, call: GrpcCall = grpcCall) {
  return {
    async transaction(txid: string): Promise<TransactionFacts> {
      return readAnswer(await call(options, SERVICE, txFilter(txid)));
    },
  };
}
