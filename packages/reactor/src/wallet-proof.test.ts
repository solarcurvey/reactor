import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  issueWalletProofChallenge,
  recoverWalletProof,
  readWalletProofParts,
  walletProofMessage,
} from "./wallet-proof.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const secret = "test-operator-policy-hmac-secret";
const chainId = 5042002;

{
  const acct = privateKeyToAccount(generatePrivateKey());
  const issued = issueWalletProofChallenge({ chainId, secret, nowSec: 1_700_000_000 });
  const sig = await acct.signMessage({ message: issued.message });
  const ok = await recoverWalletProof({
    token: issued.token,
    signature: sig,
    secret,
    expectedChainId: chainId,
    nowSec: 1_700_000_000,
  });
  assert(ok.ok && ok.address === acct.address.toLowerCase(), "recovers signer");
}

{
  const blocked = privateKeyToAccount(generatePrivateKey());
  const clear = privateKeyToAccount(generatePrivateKey());
  const issued = issueWalletProofChallenge({ chainId, secret, nowSec: 1_700_000_000 });
  const sig = await blocked.signMessage({ message: issued.message });
  const ok = await recoverWalletProof({
    token: issued.token,
    signature: sig,
    secret,
    expectedChainId: chainId,
    nowSec: 1_700_000_000,
  });
  assert(ok.ok && ok.address === blocked.address.toLowerCase(), "blocked signer recovered");
  assert(ok.ok && ok.address !== clear.address.toLowerCase(), "not the spoofed clear address");
}

{
  const issued = issueWalletProofChallenge({ chainId, secret, nowSec: 1_700_000_000, ttlSec: 10 });
  const stale = await recoverWalletProof({
    token: issued.token,
    signature: "0x11",
    secret,
    expectedChainId: chainId,
    nowSec: 1_700_000_020,
  });
  assert(!stale.ok && stale.reason === "wallet_proof_stale", "expired challenge");
}

{
  const missing = await recoverWalletProof({
    token: "",
    signature: "",
    secret,
    expectedChainId: chainId,
  });
  assert(!missing.ok && missing.reason === "wallet_missing", "empty proof");
}

{
  const issued = issueWalletProofChallenge({ chainId, secret });
  const tampered = await recoverWalletProof({
    token: issued.token.replace(/[0-9a-f]{8}$/, "aaaaaaaa"),
    signature: "0x" + "ab".repeat(65),
    secret,
    expectedChainId: chainId,
  });
  assert(!tampered.ok && tampered.reason === "wallet_invalid", "bad mac");
}

{
  const msg = walletProofMessage({ chainId, nonce: "aa".repeat(16), exp: 1 });
  assert(msg.includes("REACTOR operator-policy v1"), "message banner");
  const parts = readWalletProofParts({
    headerProof: JSON.stringify({ token: "v1.1.1.aa.bb", signature: "0x1" }),
    body: { wallet: "0x1111111111111111111111111111111111111111" },
  });
  assert(parts?.signature === "0x1", "header proof, not body.wallet");
}

console.log("wallet-proof unit ok");
