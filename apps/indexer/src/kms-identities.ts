import { execFileSync } from "node:child_process";
import { getAddress } from "viem";
import { kmsPublicKeyToAddress } from "./kms-evm.ts";
import { validateAwsKmsPublicKey, type AwsKmsPublicKeyResult } from "./aws-kms-backend.ts";

const names = ["MAINTENANCE_KMS_KEY_ID", "RELAY_A_KMS_KEY_ID", "RELAY_B_KMS_KEY_ID"] as const;
const rows = [] as Array<{ role: string; keyId: string; address: string }>;
for (const name of names) {
  const keyId = process.env[name];
  if (!keyId) throw new Error(`${name} required`);
  const raw = execFileSync(
    "aws",
    ["kms", "get-public-key", "--key-id", keyId, "--output", "json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const result = JSON.parse(raw) as AwsKmsPublicKeyResult & { PublicKey?: string };
  const validated = validateAwsKmsPublicKey({
    ...result,
    PublicKey: result.PublicKey ? Buffer.from(result.PublicKey, "base64") : undefined,
  });
  rows.push({ role: name, keyId, address: getAddress(kmsPublicKeyToAddress(validated)) });
}
const addresses = rows.map((r) => r.address.toLowerCase());
if (new Set(addresses).size !== addresses.length) throw new Error("KMS EVM addresses must be distinct");
const forbidden = (process.env.MAINTENANCE_FORBIDDEN_ADDRESSES ?? "")
  .split(",")
  .map((x) => x.trim().toLowerCase())
  .filter(Boolean);
for (const row of rows) {
  if (forbidden.includes(row.address.toLowerCase())) throw new Error(`${row.role} reuses forbidden privileged address ${row.address}`);
}
console.log(JSON.stringify({ chainId: process.env.MAINTENANCE_CHAIN_ID ?? null, keys: rows }, null, 2));
