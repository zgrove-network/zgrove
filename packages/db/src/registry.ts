import type { Db } from "./database.js";

export interface Account {
  readonly id: string;
  readonly payoutAddress: string;
}

export interface WorkerKeyBinding {
  readonly publicKey: string;
  readonly accountId: string;
  readonly workerId: number;
  /** Carried so a session can name the worker without a second lookup. */
  readonly workerName: string;
}

export interface RegisterWorkerKey {
  readonly publicKey: string;
  readonly accountId: string;
  /** The rig's name. Paired with the account id, it is the worker row. */
  readonly workerName: string;
  readonly atSeconds: number;
}

export interface Registry {
  createAccount(account: Account, atSeconds: number): void;
  findAccount(id: string): Account | null;
  /** Idempotent for the same key and account; refuses to move a key. */
  registerWorkerKey(registration: RegisterWorkerKey): WorkerKeyBinding;
  findWorkerKey(publicKey: string): WorkerKeyBinding | null;
  /** True when the account has enrolled at least one rig key. */
  hasEnrolledKeys(accountId: string): boolean;
  touchWorkerKey(publicKey: string, atSeconds: number): void;
}

interface AccountRow {
  readonly id: string;
  readonly payout_address: string;
}

interface BindingRow {
  readonly public_key: string;
  readonly account_id: string;
  readonly worker_id: number;
  readonly worker_name: string;
}

export function createRegistry(db: Db): Registry {
  const insertAccount = db.prepare(
    "INSERT INTO accounts (id, payout_address, created_at) VALUES (?, ?, ?)",
  );

  const selectAccount = db.prepare<[string], AccountRow>(
    "SELECT id, payout_address FROM accounts WHERE id = ?",
  );

  // The worker row is the same one shares are attributed to. Under a signed
  // identity its username half is the account id rather than a payout
  // address, which is the only thing about it that changes.
  const upsertWorker = db.prepare<[string, string, number, number], { id: number }>(`
    INSERT INTO workers (username, worker_name, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (username, worker_name)
      DO UPDATE SET last_seen_at = excluded.last_seen_at
    RETURNING id
  `);

  const insertKey = db.prepare(`
    INSERT INTO worker_keys (public_key, account_id, worker_id, registered_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const selectKey = db.prepare<[string], BindingRow>(`
    SELECT k.public_key, k.account_id, k.worker_id, w.worker_name
    FROM worker_keys k
    JOIN workers w ON w.id = k.worker_id
    WHERE k.public_key = ?
  `);

  const countKeys = db.prepare<[string], { n: number }>(
    "SELECT COUNT(*) AS n FROM worker_keys WHERE account_id = ?",
  );

  const touchKey = db.prepare(
    "UPDATE worker_keys SET last_seen_at = ? WHERE public_key = ?",
  );

  return {
    createAccount(account, atSeconds) {
      insertAccount.run(account.id, account.payoutAddress, atSeconds);
    },

    findAccount(id) {
      const row = selectAccount.get(id);
      return row === undefined
        ? null
        : { id: row.id, payoutAddress: row.payout_address };
    },

    registerWorkerKey(registration) {
      const existing = selectKey.get(registration.publicKey);
      if (existing !== undefined) {
        // A key that could be moved to another account would take the work
        // already recorded under it along with it.
        if (existing.account_id !== registration.accountId) {
          throw new Error(
            `Public key is already registered to another account`,
          );
        }
        return {
          publicKey: existing.public_key,
          accountId: existing.account_id,
          workerId: existing.worker_id,
          workerName: existing.worker_name,
        };
      }

      const worker = upsertWorker.get(
        registration.accountId,
        registration.workerName,
        registration.atSeconds,
        registration.atSeconds,
      );
      if (worker === undefined) {
        throw new Error("Worker upsert returned no row");
      }

      insertKey.run(
        registration.publicKey,
        registration.accountId,
        worker.id,
        registration.atSeconds,
        registration.atSeconds,
      );

      return {
        publicKey: registration.publicKey,
        accountId: registration.accountId,
        workerId: worker.id,
        workerName: registration.workerName,
      };
    },

    findWorkerKey(publicKey) {
      const row = selectKey.get(publicKey);
      return row === undefined
        ? null
        : {
            publicKey: row.public_key,
            accountId: row.account_id,
            workerId: row.worker_id,
            workerName: row.worker_name,
          };
    },

    hasEnrolledKeys(accountId) {
      return (countKeys.get(accountId)?.n ?? 0) > 0;
    },

    touchWorkerKey(publicKey, atSeconds) {
      touchKey.run(atSeconds, publicKey);
    },
  };
}
