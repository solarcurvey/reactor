import { keccak256, encodeAbiParameters, encodePacked, toBytes } from "viem";

export const LAUNCH_AUTH_TYPEHASH = keccak256(
  toBytes(
    "LaunchAuthorization(address factory,address creator,address quote,uint8 quoteDecimals,uint256 virtualQuote0,bytes32 curveConfig,bytes32 tickerHash,bytes32 authId,uint256 deadline,uint256 chainId)",
  ),
);

export const INSTANT_CURVE_V1 = keccak256(toBytes("REACTOR.InstantCurve.v1"));
export const FAIR_V1 = keccak256(toBytes("REACTOR.FairLaunch.v1"));
export const LAUNCH_AUTH_TTL_SEC = 30 * 60;

export type LaunchAuth = {
  factory: `0x${string}`;
  creator: `0x${string}`;
  quote: `0x${string}`;
  quoteDecimals: number;
  virtualQuote0: bigint;
  curveConfig: `0x${string}`;
  tickerHash: `0x${string}`;
  authId: `0x${string}`;
  deadline: bigint;
};

export function domainSeparator(chainId: bigint, verifyingContract: `0x${string}`): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
      ],
      [
        keccak256(toBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
        keccak256(toBytes("REACTOR")),
        keccak256(toBytes("1")),
        chainId,
        verifyingContract,
      ],
    ),
  );
}

export function launchAuthDigest(domain: `0x${string}`, a: LaunchAuth, chainId: bigint): `0x${string}` {
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint8" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [
        LAUNCH_AUTH_TYPEHASH,
        a.factory,
        a.creator,
        a.quote,
        a.quoteDecimals,
        a.virtualQuote0,
        a.curveConfig,
        a.tickerHash,
        a.authId,
        a.deadline,
        chainId,
      ],
    ),
  );
  return keccak256(encodePacked(["string", "bytes32", "bytes32"], ["\x19\x01", domain, structHash]));
}

export function serializeLaunchAuth(a: LaunchAuth) {
  return {
    factory: a.factory,
    creator: a.creator,
    quote: a.quote,
    quoteDecimals: a.quoteDecimals,
    virtualQuote0: a.virtualQuote0.toString(),
    curveConfig: a.curveConfig,
    tickerHash: a.tickerHash,
    authId: a.authId,
    deadline: a.deadline.toString(),
  };
}
