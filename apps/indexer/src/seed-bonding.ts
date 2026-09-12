import { createPublicClient, createWalletClient, http, parseAbi, defineChain, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { writeFileSync } from "node:fs";
import deployment from "./deployment.json" with { type: "json" };
import factoryAbi from "./abi/ReactorFactory.json" with { type: "json" };
import erc20Abi from "./abi/MockERC20.json" with { type: "json" };

const RPC = process.env.RPC_URL ?? deployment.rpc;
const A = deployment.addresses;
const ANVIL0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;

const curveAbi = parseAbi([
  "function buy(address token, uint256 quoteIn, uint256 minOut) returns (uint256)",
]);

const chain = defineChain({
  id: deployment.chainId,
  name: "reactor-local",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

async function main() {
  const account = privateKeyToAccount(ANVIL0);
  const publicClient = createPublicClient({ chain, transport: http(RPC) });
  const wallet = createWalletClient({ account, chain, transport: http(RPC) });

  const curve = A.InstantCurve as Address;
  const factory = A.ReactorFactory as Address;
  const usdc = A.USDC as Address;

  const hash = await wallet.writeContract({
    address: factory,
    abi: factoryAbi,
    functionName: "instantLaunch", // requires LaunchAuthorization — prefer `seed-review` + BONDING_TOKEN for screenshots
    args: [
      {
        name: "Neon",
        symbol: "NEON",
        decimals: 18,
        supply: 0n,
        quote: usdc,
        fdvQuoteRaw: 0n,
        devBuyQuote: 0n,
        image: "",
        description: "Protocol bonding curve. Creator picks name and ticker only — no FDV, supply, or fee knobs.",
        website: "",
        twitter: "",
        telegram: "",
      },
    ],
    account,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`launch failed ${hash}`);

  const created = await publicClient.getContractEvents({
    address: factory,
    abi: factoryAbi,
    eventName: "TokenCreated",
    fromBlock: receipt.blockNumber,
    toBlock: receipt.blockNumber,
  });
  const token = created[0]!.args.token as Address;

  await wallet.writeContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "approve",
    args: [curve, 250e6],
    account,
  });
  const buyHash = await wallet.writeContract({
    address: curve,
    abi: curveAbi,
    functionName: "buy",
    args: [token, 250e6, 1n],
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash: buyHash });

  const out = { token, quote: usdc, tx: hash };
  writeFileSync(new URL("../data/bonding-token.json", import.meta.url), JSON.stringify(out, null, 2));
  console.log("BONDING_TOKEN", token);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
