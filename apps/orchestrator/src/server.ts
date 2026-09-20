import { createServer, type Server, type Socket } from "node:net";

import type { StratumMessage } from "@zgrove/protocol";

import { readStratumLines, writeStratumMessage } from "./line-socket.js";

export interface StratumServerOptions {
  readonly host: string;
  readonly port: number;
  readonly maxConnections: number;
  readonly idleTimeoutMs: number;
}

export interface MinerConnection {
  /** Process-local, monotonic. Identifies a socket in logs before a login
   * does, and stays distinct across reconnects of the same worker. */
  readonly id: number;
  readonly remote: string;
  send(message: StratumMessage): void;
  close(reason: string): void;
}

export interface StratumServerHandlers {
  onConnect(connection: MinerConnection): void;
  onMessage(connection: MinerConnection, message: StratumMessage): void;
  onUndecodable(connection: MinerConnection, line: string): void;
  onDisconnect(connection: MinerConnection, reason: string): void;
}

export function createStratumServer(
  options: StratumServerOptions,
  handlers: StratumServerHandlers,
): Server {
  let nextId = 1;

  const server = createServer((socket) => {
    acceptConnection(socket, nextId++, options, handlers);
  });

  // Node destroys anything past this before a connection event fires, which
  // is the behaviour wanted: the cap exists to bound file descriptors, and a
  // host at its ceiling should not be spending work greeting the overflow.
  server.maxConnections = options.maxConnections;

  return server;
}

function acceptConnection(
  socket: Socket,
  id: number,
  options: StratumServerOptions,
  handlers: StratumServerHandlers,
): void {
  // Stratum messages are small and latency matters more than packing: a
  // submit delayed by Nagle is a share that may land stale upstream.
  socket.setNoDelay(true);
  socket.setTimeout(options.idleTimeoutMs);

  const remote = `${socket.remoteAddress ?? "?"}:${socket.remotePort ?? 0}`;
  let closed = false;

  const connection: MinerConnection = {
    id,
    remote,
    send(message) {
      writeStratumMessage(socket, message);
    },
    close(reason) {
      finish(reason);
      socket.destroy();
    },
  };

  // Every path out of a connection funnels through here, so a disconnect is
  // reported exactly once however the socket ended.
  function finish(reason: string): void {
    if (closed) {
      return;
    }
    closed = true;
    handlers.onDisconnect(connection, reason);
  }

  readStratumLines(socket, {
    onMessage(message) {
      handlers.onMessage(connection, message);
    },
    onUndecodable(line) {
      handlers.onUndecodable(connection, line);
    },
    onOverflow() {
      connection.close("line exceeded the stratum size ceiling");
    },
  });

  socket.on("timeout", () => {
    connection.close("idle");
  });

  // A miner that vanishes mid-share is ordinary on a mining network, so a
  // reset is a disconnect reason rather than an error to escalate.
  socket.on("error", (error: NodeJS.ErrnoException) => {
    finish(`socket error: ${error.code ?? error.message}`);
    socket.destroy();
  });

  socket.on("close", () => {
    finish("peer closed");
  });

  handlers.onConnect(connection);
}
