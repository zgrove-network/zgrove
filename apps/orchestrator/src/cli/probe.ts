import { connect as connectTcp, type Socket } from "node:net";
import { connect as connectTls } from "node:tls";
import { parseArgs } from "node:util";

import {
  StratumMethod,
  decodeStratumLine,
  encodeStratumMessage,
  isStratumRequest,
  type StratumMessage,
  type StratumRequest,
  type StratumResponse,
} from "@zgrove/protocol";

/**
 * Opens a real pool connection, completes the handshake, and writes down
 * everything the pool says. No hashing and no shares: the point is to learn
 * the dialect before a contributor's rig meets it, and every surprise a pool
 * has lives in its handshake and its notifications rather than in the shares.
 *
 * It decodes with the same code the proxy uses, so a message the proxy could
 * not parse shows up here as one it could not parse.
 */

interface Observation {
  readonly atMs: number;
  readonly raw: string;
  readonly decoded: StratumMessage | null;
}

export async function runProbe(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      host: { type: "string" },
      port: { type: "string" },
      user: { type: "string" },
      pass: { type: "string", default: "x" },
      seconds: { type: "string", default: "60" },
      tls: { type: "boolean", default: false },
      raw: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const host = required(values.host, "--host");
  const port = Number(required(values.port, "--port"));
  const user = values.user?.trim() ?? "";
  const seconds = Number(values.seconds ?? "60");

  const started = Date.now();
  const seen: Observation[] = [];

  const socket = await open(host, port, values.tls === true);
  socket.setNoDelay(true);

  let pending = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    pending += chunk;
    for (
      let newline = pending.indexOf("\n");
      newline !== -1;
      newline = pending.indexOf("\n")
    ) {
      const raw = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (raw.trim().length === 0) {
        continue;
      }
      seen.push({ atMs: Date.now() - started, raw, decoded: decodeStratumLine(raw) });
      if (values.raw === true) {
        process.stderr.write(`<< ${raw}\n`);
      }
    }
  });

  const say = (message: StratumMessage): void => {
    if (values.raw === true) {
      process.stderr.write(`>> ${JSON.stringify(message)}\n`);
    }
    socket.write(encodeStratumMessage(message));
  };

  say({ id: 1, method: StratumMethod.Subscribe, params: ["zgrove-probe/0.1"] });
  await sleep(1_500);

  // Without a login it stops after subscribe. Plenty of pools answer that
  // much, and it costs nobody an address to find out which.
  if (user !== "") {
    say({ id: 2, method: StratumMethod.Authorize, params: [user, values.pass ?? "x"] });
  }

  await sleep(seconds * 1_000);
  socket.destroy();

  report(seen, host, port, seconds, user);
  return 0;
}

function report(
  seen: readonly Observation[],
  host: string,
  port: number,
  seconds: number,
  user: string,
): void {
  const lines: string[] = [
    `pool:      ${host}:${port}`,
    `listened:  ${seconds}s`,
    `messages:  ${seen.length}`,
    "",
  ];

  const undecodable = seen.filter((o) => o.decoded === null);
  if (undecodable.length > 0) {
    // The proxy would drop these. Anything here is a gap in our decoder or a
    // dialect we do not speak, and either way it is the finding of the run.
    lines.push(`UNDECODABLE (${undecodable.length}) — the proxy would drop these:`);
    for (const o of undecodable.slice(0, 5)) {
      lines.push(`  ${truncate(o.raw, 160)}`);
    }
    lines.push("");
  }

  const subscribe = responseTo(seen, 1);
  lines.push("handshake");
  lines.push(`  subscribe result: ${subscribe === null ? "none" : summarize(subscribe)}`);
  const extranonce = readExtranonce(subscribe);
  if (extranonce !== null) {
    lines.push(`  extranonce1: ${extranonce.one} (extranonce2 size: ${extranonce.twoSize})`);
  }

  const authorize = responseTo(seen, 2);
  lines.push(
    `  authorize:        ${
      user === "" ? "skipped (no --user given)" : authorize === null ? "none" : summarize(authorize)
    }`,
  );
  lines.push("");

  const requests = seen
    .map((o) => o.decoded)
    .filter((m): m is StratumRequest => m !== null && isStratumRequest(m));

  const byMethod = new Map<string, StratumRequest[]>();
  for (const request of requests) {
    byMethod.set(request.method, [...(byMethod.get(request.method) ?? []), request]);
  }

  lines.push("what the pool pushed");
  if (byMethod.size === 0) {
    lines.push("  nothing — no jobs arrived, which usually means authorize failed");
  }
  for (const [method, messages] of byMethod) {
    const first = seen.find((o) => o.raw.includes(method));
    lines.push(
      `  ${method} x${messages.length}` +
        (first === undefined ? "" : `  (first at ${first.atMs}ms)`) +
        `  params: ${messages[0]?.params.length ?? 0}`,
    );
  }
  lines.push("");

  const difficulties = requests
    .filter((r) => r.method === StratumMethod.SetDifficulty)
    .map((r) => r.params[0])
    .filter((value): value is number => typeof value === "number");
  if (difficulties.length > 0) {
    lines.push(
      `difficulty: ${difficulties.join(" -> ")}` +
        (difficulties.length > 1 ? "   (vardiff is moving)" : ""),
    );
    lines.push("");
  }

  // The shape of a job is how the algorithm announces itself, and it is the
  // one thing the proxy relays without understanding.
  const notify = requests.find((r) => r.method === StratumMethod.Notify);
  if (notify !== undefined) {
    lines.push(`job shape: ${notify.params.length} params`);
    lines.push(`  ${notify.params.map((p) => describe(p)).join(", ")}`);
    lines.push("");
  }

  const unexpected = [...byMethod.keys()].filter(
    (method) => !KNOWN_METHODS.has(method),
  );
  if (unexpected.length > 0) {
    lines.push(`METHODS WE DO NOT MODEL: ${unexpected.join(", ")}`);
    lines.push("  The proxy relays these untouched, which may or may not be right.");
    lines.push("");
  }

  if (byMethod.has(StratumMethod.Reconnect)) {
    lines.push("NOTE: this pool sent client.reconnect. The proxy refuses to relay it.");
  }

  process.stdout.write(`${lines.join("\n")}\n`);
}

const KNOWN_METHODS = new Set<string>(Object.values(StratumMethod));

function responseTo(seen: readonly Observation[], id: number): StratumResponse | null {
  for (const observation of seen) {
    const message = observation.decoded;
    if (message !== null && !isStratumRequest(message) && message.id === id) {
      return message;
    }
  }
  return null;
}

function readExtranonce(
  response: StratumResponse | null,
): { one: string; twoSize: number } | null {
  if (response === null || !Array.isArray(response.result)) {
    return null;
  }
  const one = response.result[1];
  const twoSize = response.result[2];
  return typeof one === "string" && typeof twoSize === "number"
    ? { one, twoSize }
    : null;
}

function summarize(response: StratumResponse): string {
  if (response.error !== null) {
    return `ERROR ${JSON.stringify(response.error)}`;
  }
  return truncate(JSON.stringify(response.result), 120);
}

function describe(value: unknown): string {
  if (typeof value === "string") {
    return `string(${value.length})`;
  }
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  return typeof value;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function open(host: string, port: number, tls: boolean): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = tls
      ? connectTls({ host, port, servername: host })
      : connectTcp({ host, port });
    socket.once(tls ? "secureConnect" : "connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${flag} is required`);
  }
  return value.trim();
}

export const PROBE_USAGE = `zgrove probe — learn a real pool's dialect without mining

  --host <host>    pool hostname (required)
  --port <port>    stratum port (required)
  --user <login>   what to authorize as, usually <address>.<rig>; omitted
                   means stop after subscribe and claim no address
  --pass <pass>    password, usually x
  --seconds <n>    how long to listen after authorize (default 60)
  --tls            the port speaks stratum over TLS
  --raw            echo every line in both directions to stderr

Nothing is submitted and no hashing happens. It opens a connection, completes
the handshake, and reports what came back.
`;
