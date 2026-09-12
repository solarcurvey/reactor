import { keccak256, encodeAbiParameters, encodePacked, toBytes, stringToBytes } from "viem";

export const LAUNCH_AUTH_TYPESTRING =
  "LaunchAuthorization(address factory,uint32 factoryVersion,address creator,address quote,uint8 quoteDecimals,uint8 mode,string ticker,string name,bytes32 metadataHash,uint256 virtualQuote0,bytes32 curveConfig,bytes32 authId,uint256 deadline,uint256 chainId)";

export const LAUNCH_AUTH_TYPEHASH = keccak256(toBytes(LAUNCH_AUTH_TYPESTRING));

export const INSTANT_CURVE_V1 = keccak256(toBytes("REACTOR.InstantCurve.v1"));
/** Identifier only. Fair LaunchAuthorization binds `fairCurveConfig(...)`. */
export const FAIR_V1 = keccak256(toBytes("REACTOR.FairLaunch.v1"));
export const LAUNCH_AUTH_TTL_SEC = 30 * 60;

export const DEFAULT_SUPPLY = 1_000_000_000n * 10n ** 18n;
export const DEFAULT_DECIMALS = 18;
export const DEFAULT_FAIR_DURATION = 45 * 60;
export const DEFAULT_AUCTION_BPS = 5_000;

export function resolveFairParams(p: {
  supply?: bigint | string | number;
  decimals?: number;
  duration?: number;
  auctionBps?: number;
  minRaise?: bigint | string | number;
}) {
  const supply = BigInt(p.supply ?? 0) === 0n ? DEFAULT_SUPPLY : BigInt(p.supply ?? 0);
  const decimals = !p.decimals ? DEFAULT_DECIMALS : Number(p.decimals);
  const duration = !p.duration ? DEFAULT_FAIR_DURATION : Number(p.duration);
  const auctionBps = !p.auctionBps ? DEFAULT_AUCTION_BPS : Number(p.auctionBps);
  const minRaise = BigInt(p.minRaise ?? 0);
  return { supply, decimals, duration, auctionBps, minRaise };
}

/** Onchain `LaunchAuthorization.fairCurveConfig`. Instant keeps INSTANT_CURVE_V1. */
export function fairCurveConfig(
  supply: bigint,
  decimals: number,
  duration: number,
  auctionBps: number,
  minRaise: bigint,
): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint8" }, { type: "uint64" }, { type: "uint16" }, { type: "uint256" }],
      [supply, decimals, duration, auctionBps, minRaise],
    ),
  );
}

export function launchConfigHash(p: {
  creator: string;
  ticker: string;
  name: string;
  metadataHash: `0x${string}`;
  quote: string;
  mode: number;
  factory: string;
  factoryVersion: number;
  curveConfig: `0x${string}`;
}): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "string" },
        { type: "string" },
        { type: "bytes32" },
        { type: "address" },
        { type: "uint8" },
        { type: "address" },
        { type: "uint32" },
        { type: "bytes32" },
      ],
      [
        p.creator as `0x${string}`,
        p.ticker,
        p.name,
        p.metadataHash,
        p.quote as `0x${string}`,
        p.mode,
        p.factory as `0x${string}`,
        p.factoryVersion,
        p.curveConfig,
      ],
    ),
  );
}

export const MODE_STANDARD = 0;
export const MODE_REWARDS = 1;
export const MODE_FAIR = 2;

export const LAUNCH_AUTH_TYPES = {
  LaunchAuthorization: [
    { name: "factory", type: "address" },
    { name: "factoryVersion", type: "uint32" },
    { name: "creator", type: "address" },
    { name: "quote", type: "address" },
    { name: "quoteDecimals", type: "uint8" },
    { name: "mode", type: "uint8" },
    { name: "ticker", type: "string" },
    { name: "name", type: "string" },
    { name: "metadataHash", type: "bytes32" },
    { name: "virtualQuote0", type: "uint256" },
    { name: "curveConfig", type: "bytes32" },
    { name: "authId", type: "bytes32" },
    { name: "deadline", type: "uint256" },
    { name: "chainId", type: "uint256" },
  ],
} as const;

export type LaunchAuth = {
  factory: `0x${string}`;
  factoryVersion: number;
  creator: `0x${string}`;
  quote: `0x${string}`;
  quoteDecimals: number;
  mode: number;
  ticker: string;
  name: string;
  metadataHash: `0x${string}`;
  virtualQuote0: bigint;
  curveConfig: `0x${string}`;
  authId: `0x${string}`;
  deadline: bigint;
};

export function hashMetadata(
  image: string,
  description: string,
  website: string,
  twitter: string,
  telegram: string,
): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
      [
        keccak256(stringToBytes(image)),
        keccak256(stringToBytes(description)),
        keccak256(stringToBytes(website)),
        keccak256(stringToBytes(twitter)),
        keccak256(stringToBytes(telegram)),
      ],
    ),
  );
}

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
        { type: "uint32" },
        { type: "address" },
        { type: "address" },
        { type: "uint8" },
        { type: "uint8" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [
        LAUNCH_AUTH_TYPEHASH,
        a.factory,
        a.factoryVersion,
        a.creator,
        a.quote,
        a.quoteDecimals,
        a.mode,
        keccak256(stringToBytes(a.ticker)),
        keccak256(stringToBytes(a.name)),
        a.metadataHash,
        a.virtualQuote0,
        a.curveConfig,
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
    factoryVersion: a.factoryVersion,
    creator: a.creator,
    quote: a.quote,
    quoteDecimals: a.quoteDecimals,
    mode: a.mode,
    ticker: a.ticker,
    name: a.name,
    metadataHash: a.metadataHash,
    virtualQuote0: a.virtualQuote0.toString(),
    curveConfig: a.curveConfig,
    authId: a.authId,
    deadline: a.deadline.toString(),
  };
}

export function authMode(path: "instant" | "fair" | "standard" | "rewards"): number {
  if (path === "fair") return MODE_FAIR;
  if (path === "standard") return MODE_STANDARD;
  return MODE_REWARDS;
}
