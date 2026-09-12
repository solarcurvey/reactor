import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { applyMigrations } from "./migrations.ts";

export type SqlRow = Record<string, unknown>;

export type RunResult = { changes: number };

export interface Store {
  dialect: "sqlite" | "postgres";
  exec(sql: string): Promise<void>;
  run(sql: string, ...params: unknown[]): Promise<void>;
  runChanges(sql: string, ...params: unknown[]): Promise<RunResult>;
  get<T extends SqlRow>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  all<T extends SqlRow>(sql: string, ...params: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  tryAdvisoryLock(name: string, owner: string, ttlMs: number): Promise<boolean>;
  releaseLock(name: string, owner: string): Promise<void>;
}

function q(sql: string, dialect: "sqlite" | "postgres"): string {
  if (dialect === "sqlite") return sql;
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

class SqliteStore implements Store {
  dialect = "sqlite" as const;
  private txDepth = 0;
  private gate: Promise<void> = Promise.resolve();
  constructor(private db: DatabaseSync) {}
  async exec(sql: string) {
    this.db.exec(sql);
  }
  async run(sql: string, ...params: unknown[]) {
    this.db.prepare(sql).run(...(params as never[]));
  }
  async runChanges(sql: string, ...params: unknown[]) {
    const info = this.db.prepare(sql).run(...(params as never[]));
    return { changes: Number((info as { changes?: number }).changes ?? 0) };
  }
  async get<T extends SqlRow>(sql: string, ...params: unknown[]) {
    return this.db.prepare(sql).get(...(params as never[])) as T | undefined;
  }
  async all<T extends SqlRow>(sql: string, ...params: unknown[]) {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }
  async transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    let release: () => void = () => undefined;
    const prev = this.gate;
    this.gate = new Promise<void>((r) => {
      release = r;
    });
    await prev;
    try {
      if (this.txDepth > 0) {
        this.txDepth += 1;
        try {
          return await fn(this);
        } finally {
          this.txDepth -= 1;
        }
      }
      this.db.exec("BEGIN IMMEDIATE");
      this.txDepth = 1;
      try {
        const out = await fn(this);
        this.db.exec("COMMIT");
        return out;
      } catch (e) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
          /* ignore */
        }
        throw e;
      } finally {
        this.txDepth = 0;
      }
    } finally {
      release();
    }
  }
  async close() {
    this.db.close();
  }
  async tryAdvisoryLock(name: string, owner: string, ttlMs: number) {
    const now = Date.now();
    return this.transaction(async (tx) => {
      const row = await tx.get<{ owner: string; ts: number; lease_until?: number }>(
        "SELECT owner, ts, lease_until FROM leader_locks WHERE name=?",
        name,
      );
      const until = Number(row?.lease_until ?? (row ? Number(row.ts) + ttlMs : 0));
      if (row && until > now && row.owner !== owner) return false;
      await tx.run(
        "INSERT INTO leader_locks(name,owner,ts,lease_until) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner, ts=excluded.ts, lease_until=excluded.lease_until",
        name,
        owner,
        now,
        now + ttlMs,
      );
      return true;
    });
  }
  async releaseLock(name: string, owner: string) {
    await this.run("DELETE FROM leader_locks WHERE name=? AND owner=?", name, owner);
  }
}

class PostgresStore implements Store {
  dialect = "postgres" as const;
  private lockClients = new Map<string, { query: (t: string, p?: unknown[]) => Promise<{ rows: SqlRow[]; rowCount?: number }>; release: () => void }>();
  constructor(
    private pool: {
      query: (t: string, p?: unknown[]) => Promise<{ rows: SqlRow[]; rowCount?: number }>;
      end: () => Promise<void>;
      connect: () => Promise<{
        query: (t: string, p?: unknown[]) => Promise<{ rows: SqlRow[]; rowCount?: number }>;
        release: () => void;
      }>;
    },
  ) {}
  async exec(sql: string) {
    await this.pool.query(sql);
  }
  async run(sql: string, ...params: unknown[]) {
    await this.pool.query(q(sql, "postgres"), params);
  }
  async runChanges(sql: string, ...params: unknown[]) {
    const r = await this.pool.query(q(sql, "postgres"), params);
    return { changes: Number(r.rowCount ?? r.rows.length ?? 0) };
  }
  async get<T extends SqlRow>(sql: string, ...params: unknown[]) {
    const r = await this.pool.query(q(sql, "postgres"), params);
    return r.rows[0] as T | undefined;
  }
  async all<T extends SqlRow>(sql: string, ...params: unknown[]) {
    const r = await this.pool.query(q(sql, "postgres"), params);
    return r.rows as T[];
  }
  async transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const scoped = new PostgresStore({
      query: (t, p) => client.query(t, p),
      end: async () => undefined,
      connect: async () => client,
    });
    await client.query("BEGIN");
    try {
      const out = await fn(scoped);
      await client.query("COMMIT");
      return out;
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      client.release();
    }
  }
  async close() {
    for (const [name, c] of this.lockClients) {
      try {
        const key = Number.parseInt(createHash("sha256").update(name).digest("hex").slice(0, 8), 16);
        await c.query("SELECT pg_advisory_unlock($1)", [key]);
        c.release();
      } catch {
        /* ignore */
      }
    }
    this.lockClients.clear();
    await this.pool.end();
  }
  async tryAdvisoryLock(name: string, owner: string, ttlMs: number) {
    const now = Date.now();
    const until = now + ttlMs;
    const row = await this.get<{ owner: string }>(
      `INSERT INTO leader_locks(name,owner,ts,lease_until) VALUES(?,?,?,?)
       ON CONFLICT(name) DO UPDATE SET owner=excluded.owner, ts=excluded.ts, lease_until=excluded.lease_until
       WHERE leader_locks.lease_until IS NULL OR leader_locks.lease_until <= excluded.ts OR leader_locks.owner = excluded.owner
       RETURNING owner`,
      name,
      owner,
      now,
      until,
    );
    return row?.owner === owner;
  }
  async releaseLock(name: string, owner: string) {
    await this.run("DELETE FROM leader_locks WHERE name=? AND owner=?", name, owner);
    const client = this.lockClients.get(name);
    if (!client) return;
    const key = Number.parseInt(createHash("sha256").update(name).digest("hex").slice(0, 8), 16);
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [key]);
    } finally {
      client.release();
      this.lockClients.delete(name);
    }
  }
}

export async function openStore(opts?: { sqlitePath?: string; databaseUrl?: string }): Promise<Store> {
  const url = opts?.databaseUrl ?? process.env.DATABASE_URL ?? "";
  if (url.startsWith("postgres")) {
    const pg = await import("pg");
    const pool = new pg.default.Pool({ connectionString: url, max: 8 });
    const store = new PostgresStore(pool);
    await applyMigrations(store);
    return store;
  }
  const path = opts?.sqlitePath ?? process.env.INDEXER_DB ?? new URL("../data/reactor.sqlite", import.meta.url).pathname;
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=4000;");
  const store = new SqliteStore(db);
  await applyMigrations(store);
  return store;
}

export function newId(prefix = ""): string {
  return `${prefix}${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
