import { privateKeyToAccount } from "viem/accounts";
import {
  evaluateOperatorPolicyStatus,
  fixtureEvaluateGeo,
  gateProtectedWrite,
  issueOperatorWalletChallenge,
  minimizedStatusBody,
  resetOperatorPolicyBindState,
  setFixtureBlockedWallets,
} from "./operator-policy-bind.ts";
import { createOperatorPolicyFixtureServer } from "./operator-policy-fixture-http.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const CLEAR_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const BLOCKED_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const CLEAR = privateKeyToAccount(CLEAR_PK);
const BLOCKED = privateKeyToAccount(BLOCKED_PK);

const LOCAL: NodeJS.ProcessEnv = { REACTOR_ENV: "LOCAL", CHAIN_ID: "5042002" };
const PROD: NodeJS.ProcessEnv = {
  REACTOR_ENV: "PROD",
  NODE_ENV: "production",
  CHAIN_ID: "5042002",
  OPERATOR_POLICY_HMAC_SECRET: "production-operator-policy-hmac-secret",
};

async function proofFor(account: typeof CLEAR, env: NodeJS.ProcessEnv = LOCAL) {
  const issued = issueOperatorWalletChallenge(env);
  assert(!("error" in issued), "challenge");
  const signature = await account.signMessage({ message: issued.message });
  return JSON.stringify({ token: issued.token, signature });
}

async function main() {
  resetOperatorPolicyBindState();
  setFixtureBlockedWallets([BLOCKED.address]);

  {
    const geoOnly = await evaluateOperatorPolicyStatus({ headers: {}, env: LOCAL });
    assert(geoOnly.reason === "ALLOW", `LOCAL geo-only should allow, got ${geoOnly.reason}`);
    const claimedBlocked = await evaluateOperatorPolicyStatus({
      headers: { "x-reactor-wallet": BLOCKED.address, "x-sanctions-clear": "1" },
      env: LOCAL,
    });
    assert(claimedBlocked.reason === "ALLOW", "claimed blocked wallet is not a subject");
  }

  {
    const proof = await proofFor(BLOCKED);
    const denied = await evaluateOperatorPolicyStatus({
      headers: {
        "x-reactor-wallet-proof": proof,
        "x-reactor-wallet": CLEAR.address,
        "x-sanctions-clear": "1",
      },
      env: LOCAL,
    });
    assert(denied.reason === "DENY_ADDRESS_BLOCKED", `recovered blocked must deny, got ${denied.reason}`);
    const body = minimizedStatusBody(denied);
    const json = JSON.stringify(body);
    assert(!json.includes("203.0.113"), "no IP");
    assert(!json.toLowerCase().includes("sdn"), "no SDN");
    assert(!json.includes(BLOCKED.address.toLowerCase().slice(2, 10)) || !json.includes("wallet"), "minimized");
    assert(!("ip" in body) && !("country" in body) && !("wallet" in body), "no leak keys");
  }

  {
    const proof = await proofFor(CLEAR);
    const allowed = await evaluateOperatorPolicyStatus({
      headers: { "x-reactor-wallet-proof": proof },
      env: LOCAL,
    });
    assert(allowed.reason === "ALLOW", "clear recovered wallet allows");
  }

  {
    const missing = await gateProtectedWrite({
      headers: { "x-reactor-wallet": CLEAR.address, "x-sanctions-clear": "1" },
      body: { wallet: CLEAR.address, creator: CLEAR.address, sanctionsClear: true },
      env: LOCAL,
      surface: "POST /launch/authorize",
    });
    assert(!missing.ok, "write without proof denied");
    assert(missing.ranDownstream === false, "no downstream without proof");
    assert(missing.status === 403, "wallet missing is 403");
    assert(missing.body.reason === "UNAVAILABLE_WALLET_MISSING", String(missing.body.reason));
  }

  {
    const proof = await proofFor(BLOCKED);
    const gated = await gateProtectedWrite({
      headers: {
        "x-reactor-wallet-proof": proof,
        "x-reactor-wallet": CLEAR.address,
        "x-sanctions-clear": "1",
      },
      body: { wallet: CLEAR.address, creator: CLEAR.address, sanctionsClear: true, country: "US" },
      env: LOCAL,
      surface: "POST /launch/authorize",
    });
    assert(!gated.ok, "blocked recovered wallet denied");
    assert(gated.ranDownstream === false, "downstream must not run");
    assert(gated.status === 403, "address deny is 403");
    assert(gated.body.reason === "DENY_ADDRESS_BLOCKED", String(gated.body.reason));
    assert(!JSON.stringify(gated.body).includes(CLEAR.address.toLowerCase()), "claimed wallet not echoed as authority");
  }

  {
    const proof = await proofFor(CLEAR);
    const gated = await gateProtectedWrite({
      headers: { "x-reactor-wallet-proof": proof },
      body: { wallet: BLOCKED.address },
      env: LOCAL,
      surface: "POST /quote",
    });
    assert(gated.ok, "clear recovered allows even if body claims blocked");
    if (gated.ok) assert(gated.wallet === CLEAR.address.toLowerCase(), "subject is recovered");
  }

  {
    const prodGeo = fixtureEvaluateGeo({ "x-reactor-geo-fixture": "country=FX" }, PROD);
    assert(prodGeo.decision === "UNKNOWN", "PROD ignores unsigned geo fixture");
    const localGeo = fixtureEvaluateGeo({ "x-reactor-geo-fixture": "country=FX" }, LOCAL);
    assert(localGeo.decision === "DENY", "LOCAL geo fixture FX denies");
  }

  {
    const server = await createOperatorPolicyFixtureServer({
      env: LOCAL,
      blocked: [BLOCKED.address],
    });
    try {
      const challenge = await fetch(`${server.url}/operator-policy/challenge`).then((r) => r.json());
      const signature = await BLOCKED.signMessage({ message: challenge.message as string });
      const proof = JSON.stringify({ token: challenge.token, signature });
      const res = await fetch(`${server.url}/launch/authorize`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-reactor-wallet-proof": proof,
          "x-reactor-wallet": CLEAR.address,
          "x-sanctions-clear": "1",
        },
        body: JSON.stringify({ wallet: CLEAR.address, creator: CLEAR.address, sanctionsClear: true }),
      });
      const body = (await res.json()) as { reason?: string; ranDownstream?: boolean; ip?: string };
      assert(res.status === 403, `http gate status ${res.status}`);
      assert(body.reason === "DENY_ADDRESS_BLOCKED", String(body.reason));
      assert(body.ranDownstream === false, "http gate ranDownstream");
      assert(!body.ip, "http gate no IP");

      const noProof = await fetch(`${server.url}/launch/authorize`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-reactor-wallet": CLEAR.address },
        body: JSON.stringify({ wallet: CLEAR.address }),
      });
      const noProofBody = (await noProof.json()) as { reason?: string; ranDownstream?: boolean };
      assert(noProof.status === 403, "no proof 403");
      assert(noProofBody.reason === "UNAVAILABLE_WALLET_MISSING", String(noProofBody.reason));
      assert(noProofBody.ranDownstream === false, "no proof no downstream");

      const challengeOk = await fetch(`${server.url}/operator-policy/challenge`);
      const issued = (await challengeOk.json()) as { token?: string; message?: string };
      assert(challengeOk.ok && issued.token && issued.message, "official #62 challenge path");
      const status = await fetch(`${server.url}/operator-policy/status`);
      const statusBody = (await status.json()) as { reason?: string; wallet?: string; ip?: string };
      assert(status.ok && statusBody.reason === "ALLOW", "coordinated status is geo-only allow without proof");
      assert(!statusBody.ip && !statusBody.wallet, "status minimized");

      const blockedProof = await proofFor(BLOCKED);
      const deniedStatus = await fetch(`${server.url}/operator-policy/status`, {
        headers: { "x-reactor-wallet-proof": blockedProof, "x-reactor-wallet": CLEAR.address },
      });
      const deniedBody = (await deniedStatus.json()) as { reason?: string };
      assert(deniedStatus.status === 403 && deniedBody.reason === "DENY_ADDRESS_BLOCKED", "status screens recovered signer");
    } finally {
      await server.close();
    }
  }

  console.log("operator-policy-bind ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
