import { INDEXER_URL } from "./chain";

export type WalletProofHeader = { "x-reactor-wallet-proof": string };

export async function fetchWalletProofMessage(
  indexerUrl: string = INDEXER_URL,
): Promise<{ token: string; message: string }> {
  const res = await fetch(`${indexerUrl.replace(/\/$/, "")}/operator-policy/challenge`, {
    signal: AbortSignal.timeout(8_000),
  });
  const json = (await res.json()) as { token?: string; message?: string; error?: string };
  if (!res.ok || !json.token || !json.message) {
    throw new Error(json.error ?? "Wallet proof challenge unavailable");
  }
  return { token: json.token, message: json.message };
}

export async function signOperatorWalletProof(
  signMessage: (message: string) => Promise<string>,
  indexerUrl: string = INDEXER_URL,
): Promise<WalletProofHeader> {
  const { token, message } = await fetchWalletProofMessage(indexerUrl);
  const signature = await signMessage(message);
  return { "x-reactor-wallet-proof": JSON.stringify({ token, signature }) };
}
