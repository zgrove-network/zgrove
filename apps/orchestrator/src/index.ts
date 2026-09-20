#!/usr/bin/env node
import { isStratumRequest } from "@zgrove/protocol";

import { loadConfig } from "./config.js";
import { log } from "./log.js";
import { createStratumServer } from "./server.js";

const config = loadConfig(process.env);

const server = createStratumServer(config.stratum, {
  onConnect(connection) {
    log("info", "miner.connect", {
      miner: connection.id,
      remote: connection.remote,
    });
  },

  // Method and id only. Params carry the authorize password and, once
  // upstream is wired in, the shares themselves; none of that belongs in a
  // log file that will outlive the connection.
  onMessage(connection, message) {
    log("info", "miner.message", {
      miner: connection.id,
      method: isStratumRequest(message) ? message.method : null,
      id: message.id,
    });
  },

  // The line itself is attacker-controlled and unbounded up to the ceiling,
  // so its size is recorded and its content is not.
  onUndecodable(connection, line) {
    log("warn", "miner.undecodable", {
      miner: connection.id,
      bytes: Buffer.byteLength(line, "utf8"),
    });
  },

  onDisconnect(connection, reason) {
    log("info", "miner.disconnect", { miner: connection.id, reason });
  },
});

server.on("error", (error) => {
  log("error", "stratum.listen_failed", { message: error.message });
  process.exitCode = 1;
});

server.listen(config.stratum.port, config.stratum.host, () => {
  log("info", "stratum.listening", {
    host: config.stratum.host,
    port: config.stratum.port,
    maxConnections: config.stratum.maxConnections,
  });
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log("info", "shutdown", { signal });
    // Stops accepting; sockets already up are left to drain rather than cut
    // mid-share.
    server.close(() => {
      process.exit(0);
    });
  });
}
