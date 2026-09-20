import { issueSessionToken } from "@zgrove/protocol";

/** What a token stands for: the worker row, and who it earns for. */
export interface SessionSubject {
  readonly workerId: number;
  readonly accountId: string;
  readonly workerName: string;
}

export interface SessionStoreOptions {
  readonly ttlSeconds: number;
  readonly maxSessions: number;
}

export interface WorkerSession {
  readonly token: string;
  readonly workerId: number;
  readonly accountId: string;
  readonly workerName: string;
  readonly expiresAt: number;
}

export interface SessionStore {
  issue(binding: SessionSubject, nowSeconds: number): WorkerSession;
  resolve(token: string, nowSeconds: number): WorkerSession | null;
  size(): number;
}

/**
 * Also in memory. A restart makes every worker re-attest, which is a round
 * trip they can afford and is the safer direction: a token that outlived the
 * process that issued it would outlive whatever it was issued against.
 */
export function createSessionStore(options: SessionStoreOptions): SessionStore {
  const sessions = new Map<string, WorkerSession>();

  function expire(nowSeconds: number): void {
    for (const [token, session] of sessions) {
      if (session.expiresAt > nowSeconds) {
        return;
      }
      sessions.delete(token);
    }
  }

  return {
    issue(subject, nowSeconds) {
      expire(nowSeconds);

      while (sessions.size >= options.maxSessions) {
        const oldest = sessions.keys().next();
        if (oldest.done === true) {
          break;
        }
        sessions.delete(oldest.value);
      }

      const session: WorkerSession = {
        token: issueSessionToken(),
        workerId: subject.workerId,
        accountId: subject.accountId,
        workerName: subject.workerName,
        expiresAt: nowSeconds + options.ttlSeconds,
      };
      sessions.set(session.token, session);
      return session;
    },

    resolve(token, nowSeconds) {
      const session = sessions.get(token);
      if (session === undefined) {
        return null;
      }
      if (session.expiresAt <= nowSeconds) {
        sessions.delete(token);
        return null;
      }
      return session;
    },

    size: () => sessions.size,
  };
}
