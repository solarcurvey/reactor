/** Only Postgres 23505 / SQLite UNIQUE are treated as duplicates. Other errors rethrow. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string }; message?: string };
  const code = e.code ?? e.cause?.code;
  if (code === "23505") return true;
  const msg = String(e.message ?? "");
  if (/\b23505\b/.test(msg)) return true;
  if (/UNIQUE constraint failed/i.test(msg)) return true;
  if (/duplicate key value violates unique constraint/i.test(msg)) return true;
  return false;
}
