import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

export const FIXTURE_ADDRESSES = {
  sanctionedEvm: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  sanctionedEvmMixed: "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa",
  sanctionedEvmNoPrefix: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  sanctionedEvmDuplicate: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  clearEvm: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  sanctionedBtc: "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
  clearBtc: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
  sanctionedXmrHex: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  sanctionedTrx: "TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9",
  sanctionedSol: "So11111111111111111111111111111111111111112",
  malformedEvm: "0xdead",
  malformedEmpty: "",
} as const;

export function fixturePath(name: string): string {
  return join(FIXTURE_DIR, name);
}

export function readFixture(name: string): string {
  return readFileSync(fixturePath(name), "utf8");
}

export function pinnedFixtureBodies(): Record<string, string> {
  return {
    "ofac-sdn-xml": readFixture("sdn.xml"),
    "ofac-sdn-advanced-xml": readFixture("sdn_advanced.xml"),
    "ofac-consolidated-xml": readFixture("consolidated.xml"),
  };
}
