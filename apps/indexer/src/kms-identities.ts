import { getAddress } from "viem";
import { createAwsKmsDigestSigner } from "./aws-kms-backend.ts";
import { KmsDigestSigner } from "./kms-evm.ts";

const names = ["MAINTENANCE_KMS_KEY_ID", "RELAY_A_KMS_KEY_ID", "RELAY_B_KMS_KEY_ID"] as const;
const rows = [] as Array<{ role: string; keyId: string; address: string }>;
for (const name of names) {
  const keyId = process.env[name];
  if (!keyId) throw new Error(`${name} required`);
  const backend = await createAwsKmsDigestSigner({ keyId, region: process.env.AWS_REGION });
  const signer = new KmsDigestSigner(backend);
  rows.push({ role: name, keyId, address: getAddress(await signer.address()) });
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
