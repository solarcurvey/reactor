import {
  candidateKeys,
  extractOfacTicker,
  familyFromTicker,
  inferFamilyFromShape,
  isEvmHex,
  normalizeBtc,
  normalizeEvm,
  normalizeOther,
  normalizeTrx,
  normalizeXmr,
} from "./normalize.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

{
  const lower = normalizeEvm("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  const mixed = normalizeEvm("0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa");
  const upper = normalizeEvm("0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  const noPrefix = normalizeEvm("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert(lower === "evm:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "lowercase evm key");
  assert(mixed === lower, "checksum casing is not identity");
  assert(upper === lower, "upper casing is not identity");
  assert(noPrefix === lower, "0x prefix optional for 20-byte hex");
  assert(normalizeEvm("0xdead") === null, "short evm is malformed");
  assert(normalizeEvm("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") === null, "39 hex rejected");
  assert(normalizeEvm("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") === null, "42 hex rejected");
  assert(isEvmHex("0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb"), "mixed hex is evm-shaped");
}

{
  const btc = normalizeBtc("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2");
  assert(btc === "btc:1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2", "base58 btc is case-sensitive");
  assert(normalizeBtc("1bvbmsEYstWetqTFn5Au4m4GFg7xJaNVN2") !== btc, "must not fold base58 case");
  assert(normalizeBtc("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4") === "btc:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", "bech32 lowercased");
  assert(normalizeBtc("BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4") === "btc:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", "bech32 case-insensitive");
}

{
  assert(extractOfacTicker("Digital Currency Address - ETH") === "ETH", "classic ticker");
  assert(extractOfacTicker("Digital Currency Address – XBT") === "XBT", "en-dash ticker");
  assert(extractOfacTicker("Passport") === null, "non-dca id type");
  assert(familyFromTicker("ETH", "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") === "evm", "ETH → evm");
  assert(familyFromTicker("XBT", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2") === "btc", "XBT → btc");
  assert(familyFromTicker("USDT", "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") === "evm", "USDT hex is evm-shaped");
  assert(familyFromTicker("USDT", "TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9") === "trx", "USDT tron stays trx");
}

{
  const evmKeys = candidateKeys("0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa");
  assert(evmKeys.length === 1 && evmKeys[0] === "evm:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "evm query one key");
  const btcKeys = candidateKeys("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2");
  assert(btcKeys.length === 1 && btcKeys[0]?.startsWith("btc:"), "btc query stays btc");
  assert(candidateKeys("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "btc").length === 0, "evm hex is not a btc key");
  assert(candidateKeys("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2", "evm").length === 0, "btc is not an evm key");
  assert(inferFamilyFromShape("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") === "evm", "shape evm");
  assert(inferFamilyFromShape("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2") === "btc", "shape btc");
  assert(normalizeTrx("TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9") === "trx:TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9", "trx key");
  assert(normalizeXmr("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") === "xmr:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "xmr hex");
  assert(normalizeOther("xyz-unknown") === "other:xyz-unknown", "other exact");
  assert(candidateKeys("   ").length === 0, "blank query has no keys");
}

console.log("normalize.test.ts ok");
