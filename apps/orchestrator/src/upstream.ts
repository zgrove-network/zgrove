import { connect, type Socket } from "node:net";

import type { StratumMessage } from "@zgrove/protocol";

import { readStratumLines, writeStratumMessage } from "./line-socket.js";

export interface UpstreamOptions {
  readonly host: string;
  readonly port: number;
  readonly connectTimeoutMs: number;
}

export interface UpstreamHandlers {
  onReady(): void;
  onMessage(message: StratumMessage): void;
  onUndecodable(line: string): void;
  /** Fires once, whether the socket failed to open, errored or ended. */
  onClose(reason: string): void;
}

export interface UpstreamConnection {
  send(message: StratumMessage): void;
  close(reason: string): void;
}

/**
 * One upstream socket per miner. Sharing a single socket across miners would
 * force one difficulty onto rigs of different sizes and put every miner's ids
 * in one namespace; a pool already expects a farm to arrive as many
 * connections under one account.
 */
export function dialUpstream(
  options: UpstreamOptions,
  handlers: UpstreamHandlers,
): UpstreamConnection {
  const socket: Socket = connect({ host: options.host, port: options.port });
  socket.setNoDelay(true);

  // Guards the connect attempt only; cleared below so it cannot later fire
  // against an idle but healthy mining connection.
  socket.setTimeout(options.connectTimeoutMs);

  let closed = false;

  function finish(reason: string): void {
    if (closed) {
      return;
    }
    closed = true;
    handlers.onClose(reason);
  }

  socket.on("connect", () => {
    socket.setTimeout(0);
    handlers.onReady();
  });

  socket.on("timeout", () => {
    finish("upstream connect timed out");
    socket.destroy();
  });

  socket.on("error", (error: NodeJS.ErrnoException) => {
    finish(`upstream socket error: ${error.code ?? error.message}`);
    socket.destroy();
  });

  socket.on("close", () => {
    finish("upstream closed");
  });

  readStratumLines(socket, {
    onMessage: handlers.onMessage,
    onUndecodable: handlers.onUndecodable,
    onOverflow() {
      finish("upstream line exceeded the stratum size ceiling");
      socket.destroy();
    },
  });

  return {
    send(message) {
      writeStratumMessage(socket, message);
    },
    close(reason) {
      finish(reason);
      socket.destroy();
    },
  };
}
