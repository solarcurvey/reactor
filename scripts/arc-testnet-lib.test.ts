import assert from "node:assert/strict";
import {
  ARC_MAINNET_CHAIN_ID,
  ARC_TESTNET_CHAIN_ID,
  claimDecision,
  faucetBlockerSummary,
  isAnvil0Key,
  productionQuoteBody,
  assembleProdPathReport,
  mergeJourneyStandingBlockers,
  LOCAL_AUTHORIZE_STANDING_BLOCKERS,
  ISOLATED_PROD_ROLES,
  PUBLIC_WEB_ENV,
  SUPERSEDED_TESTNET,
  redactSecrets,
  refuseMainnet,
  ANVIL0_PK,
  type FaucetAttempt,
} from "./arc-testnet-lib.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

const prodPath = assembleProdPathReport({
  claimedDump: true,
  verificationUrl: "https://testnet.arcscan.app/tx/0xabc",
  chainId: ARC_TESTNET_CHAIN_ID,
  factoryCodeBytes: 23286,
  deployerBalanceWei: "1",
  indexerProdStart: { ok: false, detail: "PRODUCTION_HARD_GATES: refuse start/launch — TURNSTILE_SECRET" },
  gateFailures: ["TURNSTILE_SECRET", "PRICING_SIGNER_PK"],
  launchSignerIsDeployer: true,
  keeperIsDeployer: true,
  walletConnectConfigured: false,
});
assert.equal(prodPath.claimedProdPath, false);
assert.ok(prodPath.blockers.some((b) => /TURNSTILE_SECRET/.test(b)));
assert.ok(prodPath.blockers.some((b) => /isolated signer/.test(b)));
assert.ok(prodPath.blockers.some((b) => /injected/.test(b)));
assert.doesNotMatch(prodPath.blockers.join(" "), /claimedProdPath stays true/i);

assert.ok(LOCAL_AUTHORIZE_STANDING_BLOCKERS.length > 0);
assert.ok(mergeJourneyStandingBlockers([]).length >= LOCAL_AUTHORIZE_STANDING_BLOCKERS.length);
assert.ok(mergeJourneyStandingBlockers(["rpc down"]).includes("rpc down"));

const journey = JSON.parse(readFileSync(join(import.meta.dirname, "../deployments/arc-testnet-journey.json"), "utf8")) as {
  claimedArcTestnet: boolean;
  authorizeEnv: string;
  blockers: string[];
  note: string;
};
assert.equal(journey.claimedArcTestnet, true, "LOCAL authorize explorer path stays claimed");
assert.match(journey.authorizeEnv, /LOCAL/);
assert.ok(journey.blockers.length > 0, "journey blockers must not be empty while note documents LOCAL/non-PROD gaps");
assert.ok(journey.blockers.some((b) => /LOCAL/.test(b)));
assert.ok(journey.blockers.some((b) => /Turnstile/i.test(b)));
assert.ok(journey.blockers.some((b) => /Mock USDC-6|0x3600/i.test(b)));
assert.ok(journey.blockers.some((b) => /isolated signer|deployer/i.test(b)));
assert.match(journey.note, /Not full PROD/);

const prodFile = JSON.parse(readFileSync(join(import.meta.dirname, "../deployments/arc-testnet-prod-path.json"), "utf8")) as {
  claimedProdPath: boolean;
  blockers: string[];
};
assert.equal(prodFile.claimedProdPath, false);
assert.ok(prodFile.blockers.length > 0);
assert.ok(prodFile.blockers.some((b) => /SUPERSEDED/i.test(b)));
assert.ok(prodFile.blockers.some((b) => /0x2CdF/i.test(b) || /lost disposable/i.test(b)));

const isolated = JSON.parse(readFileSync(join(import.meta.dirname, "../deployments/arc-testnet-isolated.json"), "utf8")) as {
  claimedArcTestnet: boolean;
  claimedProdPath: boolean;
  expectedSafe: string;
  addresses: Record<string, string | null | undefined>;
  pendingAddresses: { Guardian: string | null; ReactorFactory: string | null };
  publicEnv: Record<string, string>;
};
assert.equal(isolated.claimedArcTestnet, false);
assert.equal(isolated.claimedProdPath, false);
assert.equal(isolated.expectedSafe.toLowerCase(), ISOLATED_PROD_ROLES.expectedSafe.toLowerCase());
assert.equal(isolated.addresses.LaunchSigner.toLowerCase(), ISOLATED_PROD_ROLES.launchSigner.toLowerCase());
assert.equal(isolated.addresses.PricingSigner.toLowerCase(), ISOLATED_PROD_ROLES.pricingSigner.toLowerCase());
assert.equal(isolated.addresses.Keeper.toLowerCase(), ISOLATED_PROD_ROLES.keeper.toLowerCase());
assert.equal(isolated.pendingAddresses.Guardian, null);
assert.equal(isolated.pendingAddresses.ReactorFactory, null);
assert.ok(!isolated.addresses.Guardian, "do not invent new ReactorGuardian");
assert.ok(!isolated.addresses.ReactorFactory, "do not invent new Factory");
assert.equal(isolated.publicEnv.NEXT_PUBLIC_WALLETCONNECT_ID, PUBLIC_WEB_ENV.NEXT_PUBLIC_WALLETCONNECT_ID);
assert.equal(isolated.publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY, PUBLIC_WEB_ENV.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

const oldDump = JSON.parse(readFileSync(join(import.meta.dirname, "../deployments/arc-testnet.json"), "utf8")) as {
  superseded: boolean;
  prodIsolated: boolean;
  addresses: { Guardian: string; ReactorFactory: string };
};
assert.equal(oldDump.superseded, true);
assert.equal(oldDump.prodIsolated, false);
assert.equal(oldDump.addresses.Guardian.toLowerCase(), SUPERSEDED_TESTNET.guardian.toLowerCase());
assert.equal(oldDump.addresses.ReactorFactory.toLowerCase(), SUPERSEDED_TESTNET.factory.toLowerCase());

assert.ok(journey.blockers.some((b) => /SUPERSEDED/i.test(b)));

console.log("arc-testnet-lib tests ok");
