import { assertProductionHardGates, productionHardGateFailures, productionHardGatesApply, wouldUseAnvilSignerFallback, ANVIL0_PK } from "./prod-gates.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

{
  const local = { REACTOR_ENV: "LOCAL" } as NodeJS.ProcessEnv;
  assert(!productionHardGatesApply(local), "LOCAL skips hard gates");
  assert(productionHardGateFailures(local).length === 0, "LOCAL has no failures");
}

{
  const unset = { NODE_ENV: "development" } as NodeJS.ProcessEnv;
  assert(!productionHardGatesApply(unset), "unset REACTOR_ENV + development is local-demo");
}

{
  const prod = { REACTOR_ENV: "PROD" } as NodeJS.ProcessEnv;
  assert(productionHardGatesApply(prod), "PROD applies gates");
  const fails = productionHardGateFailures(prod);
  assert(fails.includes("TURNSTILE_SECRET"), "PROD requires Turnstile secret");
  assert(fails.some((f) => f.includes("TURNSTILE_SITE_KEY")), "PROD requires site key");
  assert(fails.includes("PRICING_SIGNER_PK"), "PROD requires signer key");
  assert(fails.some((f) => f.includes("SIGNER_INLINE") || f.includes("SIGNER_INTERNAL")), "PROD requires isolated signer");
  let threw = false;
  try {
    assertProductionHardGates(prod);
  } catch (e) {
    threw = e instanceof Error && e.message.startsWith("PRODUCTION_HARD_GATES");
  }
  assert(threw, "PROD refuse start");
}

{
  const nodeProd = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
  assert(productionHardGatesApply(nodeProd), "NODE_ENV=production applies gates");
}

{
  const nodeProdLocal = { NODE_ENV: "production", REACTOR_ENV: "LOCAL" } as NodeJS.ProcessEnv;
  assert(!productionHardGatesApply(nodeProdLocal), "LOCAL wins over NODE_ENV=production");
}

{
  const ok: NodeJS.ProcessEnv = {
    REACTOR_ENV: "PROD",
    TURNSTILE_SECRET: "cf-secret",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0xsite",
    PRICING_SIGNER_PK: "0x" + "11".repeat(32),
    SIGNER_INTERNAL_TOKEN: "isolated-token",
    ADMISSION_HMAC_SECRET: "admission-hmac-secret-ok",
  };
  assert(productionHardGateFailures(ok).length === 0, "complete PROD env passes");
  assertProductionHardGates(ok);
}

{
  const anvil: NodeJS.ProcessEnv = {
    REACTOR_ENV: "PROD",
    TURNSTILE_SECRET: "cf-secret",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0xsite",
    PRICING_SIGNER_PK: ANVIL0_PK,
    SIGNER_INTERNAL_TOKEN: "isolated-token",
    ADMISSION_HMAC_SECRET: "admission-hmac-secret-ok",
  };
  assert(
    productionHardGateFailures(anvil).some((f) => f.includes("Anvil")),
    "Anvil #0 key refused in PROD",
  );
}

{
  const inline: NodeJS.ProcessEnv = {
    REACTOR_ENV: "PROD",
    TURNSTILE_SECRET: "cf-secret",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0xsite",
    PRICING_SIGNER_PK: "0x" + "22".repeat(32),
    SIGNER_INLINE: "1",
    SIGNER_INTERNAL_TOKEN: "isolated-token",
    ADMISSION_HMAC_SECRET: "admission-hmac-secret-ok",
  };
  assert(
    productionHardGateFailures(inline).some((f) => f.includes("SIGNER_INLINE")),
    "inline signer refused in PROD",
  );
}

{
  assert(wouldUseAnvilSignerFallback({ REACTOR_ENV: "LOCAL" }), "LOCAL without PK uses Anvil fallback");
  assert(
    !wouldUseAnvilSignerFallback({ REACTOR_ENV: "PROD", PRICING_SIGNER_PK: "0x" + "33".repeat(32) }),
    "PROD with dedicated PK is not Anvil fallback",
  );
}

console.log("prod-gates tests ok");
