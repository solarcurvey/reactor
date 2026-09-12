import { addresses, deployment } from "./addresses.ts";
import {
  TxGuardError,
  assertOfficialChain,
  chainMismatchMessage,
  discardIndexerBroadcastTx,
  officialChainId,
  resolveTradeWrite,
  sanitizeRouteHops,
} from "./tx-guard.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const TOKEN = "0x1111111111111111111111111111111111110001" as const;
const WALLET = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const EVIL = "0xDeadDeAddeAddEAddeadDEaDDEAdDeaDDEADDEaD" as const;

{
  assert(officialChainId() === deployment.chainId, "official chain is deployment");
  let threw = false;
  try {
    assertOfficialChain(1);
  } catch (e) {
    threw = e instanceof TxGuardError && e.code === "CHAIN_MISMATCH";
  }
  assert(threw, "chain 1 is blocked");
  threw = false;
  try {
    assertOfficialChain(undefined);
  } catch (e) {
    threw = e instanceof TxGuardError && e.code === "CHAIN_MISMATCH";
  }
  assert(threw, "missing chain is blocked");
  assert(assertOfficialChain(deployment.chainId) === deployment.chainId, "official chain passes");
  assert(chainMismatchMessage(1).includes("Writes are blocked"), "mismatch copy");
}

{
  const indexer = { to: EVIL, data: "0xdeadbeef" as const };
  assert(discardIndexerBroadcastTx(indexer) === null, "indexer tx discarded");
  const write = resolveTradeWrite({
    chainId: deployment.chainId,
    connected: WALLET,
    token: TOKEN,
    quote: addresses.USDC,
    curve: addresses.InstantCurve,
    kind: "router",
    indexerTx: indexer,
    metadata: {
      name: EVIL,
      image: "javascript:alert(1)",
      website: `https://evil.example/${EVIL}`,
      twitter: EVIL,
      telegram: EVIL,
    },
  });
  assert(write.to === addresses.ReactorRouter, "router target is official");
  assert(write.to.toLowerCase() !== EVIL.toLowerCase(), "evil metadata is not target");
  assert(write.recipient === WALLET, "recipient is connected wallet");
  assert(write.recipient.toLowerCase() !== EVIL.toLowerCase(), "recipient is not metadata");
  assert(write.indexerTx === null, "broadcast tx ignored");
}

{
  const curveWrite = resolveTradeWrite({
    chainId: deployment.chainId,
    connected: WALLET,
    token: TOKEN,
    quote: addresses.ZEC,
    curve: addresses.InstantCurve,
    kind: "curve",
    metadata: { name: "<script>alert(1)</script>", image: "javascript:alert(1)", website: "https://phish.example" },
  });
  assert(curveWrite.to === addresses.InstantCurve, "curve write uses sanitized curve field");
}

{
  const tokenWrite = resolveTradeWrite({
    chainId: deployment.chainId,
    connected: WALLET,
    token: TOKEN,
    quote: addresses.USDC,
    kind: "token",
    metadata: { name: EVIL },
  });
  assert(tokenWrite.to.toLowerCase() === TOKEN.toLowerCase(), "claim target is the token address field");
}

{
  let threw = false;
  try {
    resolveTradeWrite({
      chainId: 1,
      connected: WALLET,
      token: TOKEN,
      quote: addresses.USDC,
      kind: "router",
    });
  } catch (e) {
    threw = e instanceof TxGuardError && e.code === "CHAIN_MISMATCH";
  }
  assert(threw, "resolveTradeWrite blocks chain mismatch");
}

{
  const poisoned = resolveTradeWrite({
    chainId: deployment.chainId,
    connected: WALLET,
    token: EVIL,
    quote: addresses.USDC,
    kind: "router",
    indexerTx: { to: EVIL, data: "0xevil" },
    metadata: { name: EVIL, image: EVIL, website: EVIL },
  });
  assert(poisoned.to === addresses.ReactorRouter, "router to is never the poisoned token/metadata");
  assert(poisoned.to.toLowerCase() !== EVIL.toLowerCase(), "evil address is not the wallet target");
}

{
  let threw = false;
  try {
    resolveTradeWrite({
      chainId: deployment.chainId,
      connected: "not-an-address",
      token: TOKEN,
      quote: addresses.USDC,
      kind: "factory",
    });
  } catch (e) {
    threw = e instanceof TxGuardError && e.code === "BAD_RECIPIENT";
  }
  assert(threw, "recipient must be the connected wallet");
}

{
  const hops = sanitizeRouteHops([
    {
      adapter: addresses.V4Adapter,
      tokenIn: addresses.USDC,
      tokenOut: addresses.ZEC,
      minOut: 1n,
      data: "0x",
    },
  ]);
  assert(hops.length === 1 && hops[0]!.adapter === addresses.V4Adapter, "allowlisted hop");
  let threw = false;
  try {
    sanitizeRouteHops([
      {
        adapter: EVIL,
        tokenIn: addresses.USDC,
        tokenOut: addresses.ZEC,
        minOut: 1n,
        data: "0x",
      },
    ]);
  } catch (e) {
    threw = e instanceof TxGuardError && e.code === "BAD_HOP";
  }
  assert(threw, "foreign hop adapter rejected");
}

console.log("tx-guard tests ok");
