/** EIP-1193 / viem user-rejection detection. Expected 4001 must never page operators. */

import { asRecord } from "./redact";

/** MetaMask / EIP-1193 "User Rejected Request". */
export const WALLET_USER_REJECTED = 4001;

export function isUserRejection(err: unknown): boolean {
  const rec = asRecord(err);
  const code = rec?.code;
  if (code === WALLET_USER_REJECTED || code === "4001" || code === "ACTION_REJECTED") {
    return true;
  }
  const name = String(rec?.name ?? "");
  if (name === "UserRejectedRequestError" || name === "UserRejectedRequest") {
    return true;
  }
  const cause = asRecord(rec?.cause);
  if (cause && isUserRejection(cause)) return true;
  const msg = String(rec?.shortMessage ?? rec?.message ?? err ?? "").toLowerCase();
  return /user rejected|user denied|rejected the request|request rejected|user cancelled|user canceled/.test(
    msg,
  );
}
