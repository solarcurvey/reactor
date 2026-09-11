import type { Store } from "./db.ts";

export type AlertLevel = "P0" | "P1" | "warn";

export async function raiseAlert(store: Store, level: AlertLevel, code: string, detail: string) {
  await store.run("INSERT INTO alerts(level,code,detail,ts) VALUES(?,?,?,?)", level, code, detail, Date.now());
  console.error(JSON.stringify({ ts: Date.now(), kind: "alert", level, code, detail }));
}

export async function recentAlerts(store: Store, n = 50) {
  return store.all("SELECT * FROM alerts ORDER BY id DESC LIMIT ?", n);
}
