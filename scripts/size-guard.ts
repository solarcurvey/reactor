#!/usr/bin/env npx tsx
/**
 * EIP-170 runtime size guard. Arc is treated as 24576 (0x6000) unless ARC_MAX_CODE_SIZE is set.
 * Safety margin: 1024 bytes (override with SIZE_MARGIN).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const EIP170 = 24_576;
const limit = Number(process.env.ARC_MAX_CODE_SIZE ?? EIP170);
const margin = Number(process.env.SIZE_MARGIN ?? 1024);
const maxOk = limit - margin;
const contracts = ["ReactorFactory", "InstantLaunchModule", "InstantCurve", "ReactorHook", "TickerRegistry"];

type Row = { name: string; runtime: number; creation: number; ok: boolean };

function runtimeLen(name: string): Row | null {
  const p = join(root, "contracts/out", `${name}.sol`, `${name}.json`);
  if (!existsSync(p)) return null;
  const j = JSON.parse(readFileSync(p, "utf8")) as { deployedBytecode?: { object?: string }; bytecode?: { object?: string } };
  const runtime = ((j.deployedBytecode?.object ?? "0x").length - 2) / 2;
  const creation = ((j.bytecode?.object ?? "0x").length - 2) / 2;
  return { name, runtime, creation, ok: runtime <= maxOk };
}

const rows = contracts.map(runtimeLen).filter((r): r is Row => !!r);
const table = [
  "| Contract | Creation (bytes) | Runtime (bytes) | EIP-170 24576 | Margin gate |",
  "| --- | ---: | ---: | --- | --- |",
  ...rows.map((r) => `| ${r.name} | ${r.creation} | ${r.runtime} | ${r.runtime <= limit ? "under" : "OVER"} | ${r.ok ? "pass" : "FAIL"} |`),
].join("\n");

writeFileSync(join(root, "deployments/sizes.json"), JSON.stringify({ limit, margin, maxOk, rows, at: new Date().toISOString() }, null, 2));
console.log(table);
console.log(`limit=${limit} margin=${margin} maxOk=${maxOk}`);

const factory = rows.find((r) => r.name === "ReactorFactory");
if (factory && !factory.ok) {
  console.error(`ReactorFactory runtime ${factory.runtime} exceeds ${maxOk} (limit ${limit} − margin ${margin})`);
  process.exit(1);
}
