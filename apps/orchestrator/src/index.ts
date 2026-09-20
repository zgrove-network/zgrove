#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { createAccounting, migrate, openDatabase } from "@zgrove/db";
import { isStratumRequest, type WorkerIdentity } from "@zgrove/protocol";

import { loadConfig } from "./config.js";
import { log } from "./log.js";
import { createSession, type Session } from "./session.js";
import { createStratumServer, type MinerConnection } from "./server.js";

const config = loadConfig(process.env);

mkdirSync(dirname(config.accounting.databasePath), { recursive: true });
const db = openDatabase(config.accounting.databasePath);
const applied = migrate(db);
if (applied.length > 0) {
  log("info", "db.migrated", { versions: applied });
}
const accounting = createAccounting(db);

// One upsert per worker rather than one per share. The row id is stable, and
// how recently a worker was active is already readable from its buckets.
const workerIds = new Map<string, number>();

function workerIdFor(identity: WorkerIdentity): number {
  const cached = workerIds.get(identity.login);
  if (cached !== undefined) {
    return cached;
  }

  const id = accounting.touchWorker(identity, Math.floor(Date.now() / 1000));
  workerIds.set(identity.login, id);
  return id;
}

const sessions = new Map<number, Session>();

function sessionFor(connection: MinerConnection): Session {
  const existing = sessions.get(connection.id);
  if (existing !== undefined) {
    return existing;
  }

  const session = createSession(connection, config.session, {
    onIdentity(identity) {
      workerIdFor(identity);
      log("info", "worker.identified", {
        miner: connection.id,
        worker: identity.login,
      });
    },
    onDifficulty(difficulty) {
      log("info", "worker.difficulty", { miner: connection.id, difficulty });
    },

    onShare(share) {
      accounting.recordShare({
        workerId: workerIdFor(share.identity),
        algo: config.accounting.algo,
        accepted: share.accepted,
        difficulty: share.difficulty,
        atSeconds: share.atSeconds,
      });

      log("info", "share.recorded", {
        miner: connection.id,
        worker: share.identity.login,
        accepted: share.accepted,
        difficulty: share.difficulty,
      });
    },
  });

  sessions.set(connection.id, session);
  return session;
}

const server = createStratumServer(config.stratum, {
  onConnect(connection) {
    log("info", "miner.connect", {
      miner: connection.id,
      remote: connection.remote,
    });
  },

  // Method and id only. Params carry the authorize password and the shares
  // themselves; neither belongs in a log file that outlives the connection.
  onMessage(connection, message) {
    log("info", "miner.message", {
      miner: connection.id,
      method: isStratumRequest(message) ? message.method : null,
      id: message.id,
    });
    sessionFor(connection).handleMinerMessage(message);
  },

  // The line is attacker-controlled up to the ceiling, so its size is
  // recorded and its content is not.
  onUndecodable(connection, line) {
    log("warn", "miner.undecodable", {
      miner: connection.id,
      bytes: Buffer.byteLength(line, "utf8"),
    });
  },

  onDisconnect(connection, reason) {
    const session = sessions.get(connection.id);
    sessions.delete(connection.id);
    // Closes the upstream socket this miner was paired with, so a miner
    // hanging up never leaves a socket open against the pool.
    session?.end(reason);

    log("info", "miner.disconnect", {
      miner: connection.id,
      worker: session?.identity()?.login ?? null,
      reason,
    });
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
    upstream: `${config.session.upstream.host}:${config.session.upstream.port}`,
    database: config.accounting.databasePath,
    algo: config.accounting.algo,
    maxConnections: config.stratum.maxConnections,
  });
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log("info", "shutdown", { signal });
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
