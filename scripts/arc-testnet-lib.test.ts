import assert from "node:assert/strict";
import {
  ARC_MAINNET_CHAIN_ID,
  ARC_TESTNET_CHAIN_ID,
  claimDecision,
  faucetBlockerSummary,
  isAnvil0Key,
  productionQuoteBody,
  redactSecrets,
  refuseMainnet,
  ANVIL0_PK,
  type FaucetAttempt,
} from "./arc-testnet-lib.ts";

function throws(fn: () => void, re: RegExp) {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof Error && re.test(err.message), `expected ${re}`);
}

throws(() => refuseMainnet(ARC_MAINNET_CHAIN_ID), /5042/);
throws(() => claimDecision({ chainId: ARC_MAINNET_CHAIN_ID }), /5042/);

const noHash = claimDecision({ chainId: ARC_TESTNET_CHAIN_ID });
assert.equal(noHash.claimed, false);
assert.match(noHash.reason, /no broadcast hash/);

const unconfirmed = claimDecision({
  chainId: ARC_TESTNET_CHAIN_ID,
  txHash: "0x" + "ab".repeat(32),
  explorerConfirmed: false,
});
assert.equal(unconfirmed.claimed, false);
assert.match(unconfirmed.reason, /explorer receipt not confirmed/);

const wrongChain = claimDecision({ chainId: 1, txHash: "0x1" });
assert.equal(wrongChain.claimed, false);

const oversized = claimDecision({ chainId: ARC_TESTNET_CHAIN_ID, runtimeOverEip170: true });
assert.equal(oversized.claimed, false);

const confirmed = claimDecision({
  chainId: ARC_TESTNET_CHAIN_ID,
  txHash: "0x" + "cd".repeat(32),
  explorerConfirmed: true,
});
assert.equal(confirmed.claimed, true);

assert.equal(isAnvil0Key(ANVIL0_PK), true);
assert.equal(isAnvil0Key("0x" + "11".repeat(32)), false);

const redacted = redactSecrets({ ARC_TESTNET_PK: "0x" + "aa".repeat(32), address: "0xabc", nested: { secret: "x" } });
assert.equal(redacted.address, "0xabc");
assert.match(String(redacted.ARC_TESTNET_PK), /redacted/);
assert.match(String((redacted.nested as { secret: string }).secret), /redacted/);

const attempts: FaucetAttempt[] = [
  {
    method: "POST GraphQL RequestToken",
    url: "https://faucet.circle.com/api/graphql",
    httpStatus: 200,
    ok: false,
    error: "RECAPTCHA_ERROR — ReCAPTCHA verification failed",
    note: "human widget",
  },
];
assert.match(faucetBlockerSummary(attempts), /RECAPTCHA_ERROR/);
assert.doesNotMatch(faucetBlockerSummary(attempts), /dripped|success/i);

const buyBody = productionQuoteBody({
  side: "BUY",
  token: "0x62A7aDF0deb2c1918603e9834dD9ACe07CDA2f87",
  usdc: "0x44CBe037ABFA8696E4466cA9D278Dbbe44B932dC",
  amountIn: "1000000",
  slippageBps: 100,
  recipient: "0xbeD4a2d496d280387FE65922fFbdf8C0f724bC6E",
});
assert.equal(buyBody.kind, "BUY");
assert.equal(buyBody.tokenIn.toLowerCase(), "0x44cbe037abfa8696e4466ca9d278dbbe44b932dc");
assert.equal(buyBody.tokenOut, buyBody.token);
const sellBody = productionQuoteBody({ ...buyBody, side: "SELL", token: buyBody.token, usdc: buyBody.tokenIn, amountIn: "2", slippageBps: 100, recipient: buyBody.recipient });
assert.equal(sellBody.kind, "SELL");
assert.equal(sellBody.tokenIn, buyBody.token);
assert.equal(sellBody.tokenOut.toLowerCase(), buyBody.tokenIn.toLowerCase());

console.log("arc-testnet-lib tests ok");
