import type { Socket } from "node:net";

import {
  MAX_STRATUM_LINE_BYTES,
  decodeStratumLine,
  encodeStratumMessage,
  type StratumMessage,
} from "@zgrove/protocol";

export interface LineHandlers {
  onMessage(message: StratumMessage): void;
  /** A line that arrived intact but is not a stratum message. */
  onUndecodable(line: string): void;
  /** No newline arrived before the buffer passed the ceiling. */
  onOverflow(): void;
}

/**
 * Stratum has no length prefix: a message is whatever precedes the next
 * newline, and a peer is free to split one across TCP segments or pack
 * several into one. Everything here follows from that.
 */
export function readStratumLines(socket: Socket, handlers: LineHandlers): void {
  // A StringDecoder underneath, so a multi-byte character split across two
  // segments is held back rather than delivered as two broken halves.
  socket.setEncoding("utf8");

  let pending = "";
  let overflowed = false;

  socket.on("data", (chunk: string) => {
    if (overflowed) {
      return;
    }

    pending += chunk;

    for (
      let newline = pending.indexOf("\n");
      newline !== -1;
      newline = pending.indexOf("\n")
    ) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);

      const message = decodeStratumLine(line);
      if (message === null) {
        handlers.onUndecodable(line);
      } else {
        handlers.onMessage(message);
      }
    }

    // Checked on the remainder only, after every complete line has been taken
    // out: a peer that pipelines a megabyte of valid messages in one segment
    // is well behaved, while one that sends a megabyte without a newline is
    // growing this buffer on purpose.
    if (Buffer.byteLength(pending, "utf8") > MAX_STRATUM_LINE_BYTES) {
      overflowed = true;
      pending = "";
      handlers.onOverflow();
    }
  });
}

export function writeStratumMessage(
  socket: Socket,
  message: StratumMessage,
): void {
  if (socket.writableEnded || socket.destroyed) {
    return;
  }
  socket.write(encodeStratumMessage(message));
}
