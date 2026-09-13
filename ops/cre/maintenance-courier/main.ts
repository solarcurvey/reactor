/**
 * Official CRE TypeScript workflow (HTTP trigger).
 *
 * A logged-in `cre workflow simulate maintenance-courier --target staging-settings`
 * compiles this file to WASM and runs it locally. Default --broadcast is false.
 *
 * This workflow only delivers a pre-signed MaintenanceJob. It does not rank,
 * simulate routes, or write on Arc Mainnet 5042. Live DON deploy is not claimed.
 */
import { HTTPCapability, decodeJson, handler, Runner, type HTTPPayload, type Runtime } from "@chainlink/cre-sdk";
import { handleSignedJobPayload, type SignedJobHttpPayload } from "./handle-signed-job.ts";

type Config = {
  authorizedEVMAddress: string;
  creCatalogChain: string;
  creCatalogChainId: number;
  repoLocalChainId: number;
  arcMainnet: number;
  broadcast: boolean;
  note: string;
};

const onHttpTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
  runtime.log("reactor maintenance courier: HTTP trigger (signed MaintenanceJob only)");
  runtime.log(
    `catalog=${runtime.config.creCatalogChain} eip155=${runtime.config.creCatalogChainId} repoLocal=${runtime.config.repoLocalChainId} mainnet=${runtime.config.arcMainnet} broadcast=${runtime.config.broadcast}`,
  );
  if (!payload.input || payload.input.length === 0) {
    throw new Error("HTTP trigger payload is empty — expected a signed MaintenanceJob JSON body");
  }
  const input = decodeJson<SignedJobHttpPayload>(payload.input);
  const result = handleSignedJobPayload(input);
  runtime.log(`jobId=${result.jobId} action=${result.action} jobChainId=${result.jobChainId}`);
  runtime.log(`relayCalldataHash=${result.relayCalldataHash}`);
  runtime.log(`creOnReportHash=${result.creOnReportHash}`);
  runtime.log("no broadcast; no target.call; minOut/targets not rebuilt");
  return JSON.stringify(result);
};

const initWorkflow = (config: Config) => {
  const http = new HTTPCapability();
  // Simulation allows empty authorizedKeys. Deployed workflows must set them.
  return [
    handler(
      http.trigger({
        authorizedKeys: [
          {
            type: "KEY_TYPE_ECDSA_EVM",
            publicKey: config.authorizedEVMAddress,
          },
        ],
      }),
      onHttpTrigger,
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
