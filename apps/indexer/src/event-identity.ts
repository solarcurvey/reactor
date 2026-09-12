/**
 * Canonical append-only identity: (chain_id, tx, log_index, event_kind)
 * plus emitting `address` stored on the shared journal.
 */
import type { Store } from "./db.ts";
import { isUniqueViolation } from "./unique.ts";

export const EVENT_IDENTITY_CONFLICT = "ON CONFLICT(chain_id, tx, log_index, event_kind) DO NOTHING";

export type JournalEvent = {
  chainId: number;
  tx: string;
  logIndex: number;
  eventKind: string;
  address: string;
  block: number;
  ts: number;
};

export function normalizeEventAddress(value: string | undefined | null): string {
  return String(value ?? "").toLowerCase();
}

export async function insertLogOnce(store: Store, sql: string, ...params: unknown[]): Promise<boolean> {
  try {
    const r = await store.runChanges(sql, ...params);
    return r.changes > 0;
  } catch (e) {
    if (isUniqueViolation(e)) return false;
    throw e;
  }
}

export async function journalEvent(store: Store, row: JournalEvent): Promise<boolean> {
  return insertLogOnce(
    store,
    `INSERT INTO indexer_event_journal(chain_id,tx,log_index,event_kind,address,block,ts)
     VALUES(?,?,?,?,?,?,?) ${EVENT_IDENTITY_CONFLICT}`,
    row.chainId,
    row.tx,
    row.logIndex,
    row.eventKind,
    normalizeEventAddress(row.address),
    row.block,
    row.ts,
  );
}
