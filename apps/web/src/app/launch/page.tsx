"use client";

import { useEffect, useRef, useState } from "react";
import { usePublicClient, useSignMessage, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "viem/actions";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ServiceFailure } from "@/components/service-failure";
import { useQuotes, useTickerStatus } from "@/lib/hooks";
import { FAILURE_COPY, isServiceUnavailable } from "@/lib/qa-inject";
import { useQaScene } from "@/components/qa-inject-provider";
import { factory, erc20, launchAbi } from "@/lib/contracts";
import { parseUnitsSafe } from "@/lib/utils";
import { TurnstileWidget, turnstileSiteKey } from "@/components/turnstile";
import { sanitizeDescription, sanitizeMediaUrl, sanitizeTokenName, untrustedMetadataReasons } from "@/lib/untrusted-metadata";
import { SafeTokenImage } from "@/components/safe-media";
import { TxGuardError, resolveTradeWrite } from "@/lib/tx-guard";
import { useOperatedWrites } from "@/lib/use-operated-writes";
import { RestrictedNotice } from "@/components/restricted-notice";
import { UntrustedText } from "@/components/untrusted-text";

export default function LaunchPage() {
  const router = useRouter();
  const {
    address,
    isConnected,
    writesEnabled,
    matched,
    mismatchMessage,
    chainId,
    policy,
    policyBlocked,
    writeBlockMessage,
    writeButtonLabel,
  } = useOperatedWrites();
  const client = usePublicClient();
  const { data: quotes, isError: quotesError, error: quotesErr, refetch: refetchQuotes } = useQuotes();
  const scene = useQaScene();
  const { writeContractAsync, isPending } = useWriteContract();
  const { signMessageAsync } = useSignMessage();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [image, setImage] = useState("");
  const [description, setDescription] = useState("");
  const [quote, setQuote] = useState<`0x${string}` | "">("");
  const [rewards, setRewards] = useState(true);
  const [path, setPath] = useState<"instant" | "fair">("instant");
  const [devBuy, setDevBuy] = useState("");
  const [durationMin, setDurationMin] = useState("45");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "quoting" | "awaiting_wallet" | "pending" | "confirmed">("idle");
  const submitLock = useRef(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [needsChallenge, setNeedsChallenge] = useState(false);
  const siteKey = turnstileSiteKey();

  const selected = quotes?.find((q) => q.token.toLowerCase() === quote.toLowerCase());
  const skipRemoteTicker = Boolean(scene.inject === "ticker-invalid" || scene.state === "ticker-reserved" || scene.state === "ticker-available");
  const { data: tickerRemote } = useTickerStatus(skipRemoteTicker ? "" : symbol);
  const [tickerOverride, setTickerOverride] = useState("");

  useEffect(() => {
    if (scene.state === "ticker-reserved") {
      setSymbol((s) => s || "NEON");
      setTickerOverride("NEON is reserved");
      return;
    }
    if (scene.state === "ticker-available") {
      setSymbol((s) => s || "ZCAT");
      setTickerOverride("ZCAT available · 24h lock on success");
      return;
    }
    if (scene.inject === "ticker-invalid") {
      setSymbol((s) => s || "!!");
      setTickerOverride("Ticker failed normalize / reserve rules");
      setError(FAILURE_COPY["ticker-invalid"].body);
      return;
    }
    setTickerOverride("");
  }, [scene.inject, scene.state]);

  useEffect(() => {
    if (scene.state === "standard" || scene.state === "rewards" || scene.state === "devbuy") {
      setName((n) => n || "Neon");
      setSymbol((s) => s || "NEON");
    }
    if (scene.state === "standard") {
      setRewards(false);
      setDevBuy("");
    }
    if (scene.state === "rewards") setRewards(true);
    if (scene.state === "devbuy") {
      setRewards(true);
      setDevBuy("50");
    }
    if (scene.state === "upload-ok") {
      setImage((img) => img || "/icons/zcat.svg");
    }
    if (scene.inject === "upload") setError(FAILURE_COPY.upload.body);
    if (scene.inject === "pricing") setError(FAILURE_COPY.pricing.body);
  }, [scene.inject, scene.state]);

  const tickerStatus = tickerOverride || tickerRemote || "";

  async function authorizeLaunch(quoteAddr: `0x${string}`, ticker: string, mode: "instant" | "fair") {
    const proof = await policy.ensureProof();
    const res = await fetch("/api/launch-pricing", {
      method: "POST",
      headers: { "content-type": "application/json", ...proof },
      body: JSON.stringify({
        quote: quoteAddr,
        creator: address,
        wallet: address,
        ticker,
        mode: mode === "fair" ? "fair" : rewards ? "rewards" : "standard",
        name: sanitizeTokenName(name),
        image: sanitizeMediaUrl(image),
        description: sanitizeDescription(description),
        turnstile: turnstileToken,
        factory: factory.address,
        factoryVersion: 1,
        duration: path === "fair" ? Math.floor(Number(durationMin) * 60) : undefined,
        supply: 0,
        decimals: 18,
        auctionBps: 0,
        minRaise: 0,
      }),
    });
    const body = (await res.json()) as {
      needsAuth?: boolean;
      ticker?: string;
      decision?: string;
      challenge?: string;
      reasons?: string[];
      auth?: {
        factory: `0x${string}`;
        factoryVersion: number;
        creator: `0x${string}`;
        quote: `0x${string}`;
        quoteDecimals: number;
        mode: number;
        ticker: string;
        name: string;
        metadataHash: `0x${string}`;
        virtualQuote0: string;
        curveConfig: `0x${string}`;
        authId: `0x${string}`;
        deadline: string;
      };
      signature?: `0x${string}`;
      error?: string;
      reason?: string;
    };
    if (body.decision === "deny" || body.decision === "unavailable") {
      throw new Error(body.error ?? "REACTOR-operated services are unavailable for this request.");
    }
    if (body.decision === "CHALLENGE") {
      setNeedsChallenge(true);
      throw new Error(body.error ?? "Complete the Cloudflare Turnstile challenge, then retry. CHALLENGE is not ALLOW.");
    }
    if (!res.ok || !body.auth || !body.signature) {
      if (policy.applyWriteError(body)) {
        throw new Error(body.error ?? "REACTOR-operated launch authorization is unavailable.");
      }
      throw new Error(body.error ?? body.reasons?.join(", ") ?? "Launch authorization unavailable");
    }
    return {
      auth: {
        factory: body.auth.factory,
        factoryVersion: body.auth.factoryVersion,
        creator: body.auth.creator,
        quote: body.auth.quote,
        quoteDecimals: body.auth.quoteDecimals,
        mode: body.auth.mode,
        ticker: body.auth.ticker,
        name: body.auth.name,
        metadataHash: body.auth.metadataHash,
        virtualQuote0: BigInt(body.auth.virtualQuote0),
        curveConfig: body.auth.curveConfig,
        authId: body.auth.authId,
        deadline: BigInt(body.auth.deadline),
      },
      signature: body.signature,
      ticker: body.ticker ?? body.auth.ticker ?? ticker,
    };
  }

  async function submit() {
    if (submitLock.current) return;
    submitLock.current = true;
    setError(null);
    if (policyBlocked) {
      submitLock.current = false;
      setError(writeBlockMessage ?? policy.userMessage);
      return;
    }
    if (!isConnected || !client || !selected || !address) {
      submitLock.current = false;
      setError("Connect a wallet and pick a quote asset.");
      return;
    }
    if (!writesEnabled) {
      submitLock.current = false;
      setError(writeBlockMessage ?? mismatchMessage);
      return;
    }
    try {
      setPhase("quoting");
      const write = resolveTradeWrite({
        chainId,
        connected: address,
        token: selected.token,
        quote: selected.token,
        kind: "factory",
        metadata: { name, image, website: "" },
      });
      const safeName = sanitizeTokenName(name);
      const safeDescription = sanitizeDescription(description);
      const safeImage = sanitizeMediaUrl(image);
      const blocked = untrustedMetadataReasons({
        name,
        description,
        image,
        website: "",
        twitter: "",
        telegram: "",
      });
      if (blocked.length || (image && !safeImage)) {
        setError("Token identity is treated as untrusted. HTML, javascript:/data: URLs, and off-policy images are rejected.");
        return;
      }
      const params = {
        name: safeName,
        symbol: symbol.toUpperCase(),
        decimals: 18,
        supply: 0n,
        quote: selected.token,
        fdvQuoteRaw: 0n,
        devBuyQuote: parseUnitsSafe(devBuy || "0", selected.decimals),
        image: safeImage,
        description: safeDescription,
        website: "",
        twitter: "",
        telegram: "",
      };
      const priced = await authorizeLaunch(selected.token, params.symbol, path);
      params.symbol = priced.ticker;
      setPhase("awaiting_wallet");
      if (path === "instant") {
        if (params.devBuyQuote > 0n) {
          const allowance = (await client.readContract({
            address: selected.token,
            abi: erc20.abi,
            functionName: "allowance",
            args: [write.recipient, write.to],
          })) as bigint;
          if (allowance < params.devBuyQuote) {
            const ah = await writeContractAsync({
              address: selected.token,
              abi: erc20.abi,
              functionName: "approve",
              args: [write.to, params.devBuyQuote],
            });
            setPhase("pending");
            const approveReceipt = await waitForTransactionReceipt(client, { hash: ah, pollingInterval: 200 });
            if (approveReceipt.status === "reverted") throw new Error("Transaction reverted.");
            setPhase("awaiting_wallet");
          }
          const hash = await writeContractAsync({
            address: write.to,
            abi: launchAbi,
            functionName: "launchAndBuy",
            args: [params, rewards, 1n, priced.auth, priced.signature],
          });
          setPhase("pending");
          const receipt = await waitForTransactionReceipt(client, { hash, pollingInterval: 200 });
          if (receipt.status === "reverted") throw new Error("Transaction reverted.");
          setPhase("confirmed");
        } else if (rewards) {
          const hash = await writeContractAsync({
            address: write.to,
            abi: launchAbi,
            functionName: "instantLaunch",
            args: [params, priced.auth, priced.signature],
          });
          setPhase("pending");
          const receipt = await waitForTransactionReceipt(client, { hash, pollingInterval: 200 });
          if (receipt.status === "reverted") throw new Error("Transaction reverted.");
          setPhase("confirmed");
        } else {
          const hash = await writeContractAsync({
            address: write.to,
            abi: launchAbi,
            functionName: "launchStandard",
            args: [params, priced.auth, priced.signature],
          });
          setPhase("pending");
          const receipt = await waitForTransactionReceipt(client, { hash, pollingInterval: 200 });
          if (receipt.status === "reverted") throw new Error("Transaction reverted.");
          setPhase("confirmed");
        }
        router.push("/");
      } else {
        const hash = await writeContractAsync({
          address: write.to,
          abi: launchAbi,
          functionName: "createFairLaunch",
          args: [
            {
              name: safeName,
              symbol: priced.ticker,
              decimals: 18,
              supply: 0n,
              quote: selected.token,
              duration: BigInt(Math.floor(Number(durationMin) * 60)),
              auctionBps: 0,
              minRaise: 0n,
              image: safeImage,
              description: safeDescription,
              website: "",
              twitter: "",
              telegram: "",
            },
            priced.auth,
            priced.signature,
          ],
        });
        setPhase("pending");
        const receipt = await waitForTransactionReceipt(client, { hash, pollingInterval: 200 });
        if (receipt.status === "reverted") throw new Error("Transaction reverted.");
        setPhase("confirmed");
        router.push("/");
      }
    } catch (e) {
      setPhase("idle");
      setError(e instanceof TxGuardError || e instanceof Error ? e.message : "Launch failed");
    } finally {
      submitLock.current = false;
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-200/80">Instant · bonding → v4 · Factory V1</p>
      <h1 className="mt-1 text-2xl font-semibold">Ignite a market</h1>
      <p className="mt-1 text-[13px] text-zinc-400">
        You pick image, name, ticker, description, quote, and Standard vs Rewards. Protocol owns supply, curve, FDV,
        and fees. Same Instant config for every launch.{" "}
        <Link href="/docs/creators" className="text-cyan-200 underline">
          Creator docs
        </Link>
        {" · "}
        <Link href="/docs/tickers" className="text-cyan-200 underline">
          Ticker rules
        </Link>
      </p>

      <RestrictedNotice className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/8 px-4 py-3 text-[13px] text-amber-50" />

      <Card className="mt-4 space-y-3 p-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label htmlFor="launch-name" className="mb-1 block text-[11px] uppercase tracking-wider text-zinc-400">
              Name
            </label>
            <Input id="launch-name" name="name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="launch-ticker" className="mb-1 block text-[11px] uppercase tracking-wider text-zinc-400">
              Ticker
            </label>
            <Input
              id="launch-ticker"
              name="ticker"
              placeholder="Ticker"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              maxLength={10}
            />
            {tickerStatus && (
              <p data-testid="ticker-status" className="mt-1 text-[11px] text-zinc-400">
                {tickerStatus}
              </p>
            )}
          </div>
        </div>
        <div>
          <label htmlFor="launch-image" className="mb-1 block text-[11px] uppercase tracking-wider text-zinc-400">
            Image
          </label>
          <input
            id="launch-image-file"
            type="file"
            accept="image/*"
            aria-label="Upload token image"
            className="mb-2 block w-full text-[12px] text-zinc-400"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 2_000_000) {
                setError("Image must be under 2MB");
                return;
              }
              try {
                const { INDEXER_URL } = await import("@/lib/chain");
                const proof = await policy.ensureProof();
                const res = await fetch(`${INDEXER_URL}/upload`, { method: "POST", headers: { ...proof }, body: file });
                const body = (await res.json()) as { publicUrl?: string; uri?: string; error?: string; reason?: string };
                if (!res.ok) {
                  if (policy.applyWriteError(body)) throw new Error(body.error ?? "upload unavailable");
                  throw new Error(body.error ?? "upload failed");
                }
                const next = sanitizeMediaUrl(body.publicUrl ?? body.uri ?? "");
                if (!next) throw new Error("upload returned a URL the launchpad will not render");
                setImage(next);
              } catch (err) {
                setError(err instanceof Error ? err.message : "upload failed — no base64 onchain");
              }
            }}
          />
          <Input
            id="launch-image"
            name="image"
            placeholder="or paste first-party /m/…webp URL"
            value={image.startsWith("data:") ? "" : image}
            onChange={(e) => {
              const next = e.target.value;
              if (!next) {
                setImage("");
                return;
              }
              const safe = sanitizeMediaUrl(next);
              if (!safe) {
                setError("Image URL must be a REACTOR media path (/m/<id>.webp). javascript/data/remote hosts are rejected.");
                return;
              }
              setError(null);
              setImage(safe);
            }}
          />
          {image ? (
            <span data-testid="launch-upload-preview">
              <SafeTokenImage src={image} className="mt-2 h-16 w-16 rounded-lg object-cover" />
            </span>
          ) : null}
        </div>
        <div>
          <label htmlFor="launch-description" className="mb-1 block text-[11px] uppercase tracking-wider text-zinc-400">
            Description
          </label>
          <textarea
            id="launch-description"
            name="description"
            className="min-h-16 w-full rounded-xl border border-white/10 bg-black/30 p-3 text-sm"
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="text-[11px] uppercase tracking-wider text-zinc-400" id="quote-asset-label">
          Quote asset
        </div>
        <div className="grid gap-2" role="group" aria-labelledby="quote-asset-label">
          {(quotes ?? []).map((q) => (
            <button
              key={q.token}
              type="button"
              aria-pressed={quote === q.token}
              onClick={() => setQuote(q.token)}
              className={`flex items-center justify-between rounded-xl border px-4 py-2.5 text-left ${
                quote === q.token ? "border-cyan-300/50 bg-cyan-300/10" : "border-white/8 bg-black/20"
              }`}
            >
              <span>
                <span className="font-medium">{q.symbol}</span>
                <span className="ml-2 text-xs text-zinc-400">{q.name}</span>
              </span>
              <span className="text-[11px] uppercase tracking-wider text-cyan-100">EARNS {q.symbol}</span>
            </button>
          ))}
          {quotesError && (
            <ServiceFailure
              kind={isServiceUnavailable(quotesErr) ? quotesErr.kind : "rpc"}
              onRetry={() => refetchQuotes()}
            />
          )}
          {!quotesError && !quotes?.length && <p className="text-sm text-zinc-400">Loading quote registry…</p>}
        </div>

        {path === "instant" && (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                aria-pressed={rewards}
                onClick={() => setRewards(true)}
                className={`rounded-2xl border p-4 text-left ${
                  rewards ? "border-cyan-300/50 bg-cyan-300/10" : "border-white/8 bg-black/20"
                }`}
              >
                <div className="text-[11px] uppercase tracking-wider text-cyan-200">
                  EARNS {selected?.symbol ?? "X"}
                </div>
                <div className="mt-1 text-sm font-medium">Rewards · 2% to holders</div>
                <p className="mt-1 text-[12px] text-zinc-400">Same-quote holder rewards from trade #1. + 1% Top-10 + 0.5% CORE.</p>
              </button>
              <button
                type="button"
                aria-pressed={!rewards}
                onClick={() => setRewards(false)}
                className={`rounded-2xl border p-4 text-left ${
                  !rewards ? "border-amber-300/50 bg-amber-300/10" : "border-white/8 bg-black/20"
                }`}
              >
                <div className="text-[11px] uppercase tracking-wider text-amber-200">BUY + BURN</div>
                <div className="mt-1 text-sm font-medium">Standard · 2% self-buy</div>
                <p className="mt-1 text-[12px] text-zinc-400">2% later market-buys this token and burns it. Same 1% / 0.5%.</p>
              </button>
            </div>
            <label htmlFor="launch-devbuy" className="block text-[11px] uppercase tracking-wider text-zinc-400">
              Optional Dev Buy ({selected?.symbol ?? "quote"} · max 5% token out · full 3.5%)
            </label>
            <Input
              id="launch-devbuy"
              name="devBuy"
              inputMode="decimal"
              value={devBuy}
              onChange={(e) => setDevBuy(e.target.value)}
              placeholder="0"
            />
          </>
        )}

        <button
          className="text-[11px] text-zinc-400 underline"
          onClick={() => setPath((p) => (p === "instant" ? "fair" : "instant"))}
        >
          {path === "instant" ? "Use Batch Fair Launch instead" : "Back to Instant bonding"}
        </button>
        {path === "fair" && (
          <>
            <p className="text-[13px] text-zinc-400">
              Pro-rata timed sale — not CCA. 50/50 locked. 0% during the sale. Clearing price opens the official pool.
            </p>
            <label htmlFor="launch-duration" className="block text-[11px] uppercase tracking-wider text-zinc-400">
              Auction length (minutes)
            </label>
            <Input
              id="launch-duration"
              name="duration"
              inputMode="numeric"
              value={durationMin}
              onChange={(e) => setDurationMin(e.target.value)}
            />
          </>
        )}

        <div className="rounded-xl border border-white/8 bg-black/20 p-3 text-[12px] text-zinc-400">
          Protocol: 1B / 18 dec · 79.31% curve · 20.69% locked v4 at graduation · ~$5k USDC start FDV · 3.5% from trade
          #1. No creator FDV, supply, or fee knobs. Fair LaunchAuthorization binds supply / decimals / duration /
          auctionBps / minRaise.
        </div>
        {(needsChallenge || siteKey) && (
          <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/5 p-3">
            <p className="text-[12px] text-cyan-100">
              {needsChallenge
                ? "Admission returned CHALLENGE. Solve Turnstile, then launch again — a solved challenge can ALLOW under limits."
                : "Cloudflare Turnstile is required when the launch signer is wired."}
            </p>
            {siteKey ? (
              <TurnstileWidget siteKey={siteKey} onToken={setTurnstileToken} />
            ) : (
              <p className="mt-2 text-[11px] text-zinc-400">
                LOCAL: no site key — backend bypasses Turnstile unless TURNSTILE_REQUIRED=1.
              </p>
            )}
          </div>
        )}
      </Card>

      {(scene.inject === "pricing" || scene.inject === "upload" || scene.inject === "ticker-invalid") && (
        <ServiceFailure kind={scene.inject} />
      )}
      {error && scene.inject !== "pricing" && scene.inject !== "upload" && scene.inject !== "ticker-invalid" ? (
        <p role="alert" data-testid="launch-error" className="mt-3 text-sm text-red-300">
          <UntrustedText as="span" field="toast">
            {error}
          </UntrustedText>
        </p>
      ) : null}
      {!matched && isConnected && (
        <UntrustedText as="p" field="toast" className="mt-3 text-sm text-red-300">
          {mismatchMessage}
        </UntrustedText>
      )}
      <p data-testid="launch-phase" data-phase={phase} className="mt-2 text-[11px] uppercase tracking-wider text-zinc-400">
        {phase === "awaiting_wallet" ? "approval/signature" : phase === "pending" ? "submitted/pending" : phase === "quoting" ? "quoting" : phase}
      </p>
      <Button
        className="mt-4 w-full"
        onClick={submit}
        disabled={isPending || phase === "awaiting_wallet" || phase === "pending" || !writesEnabled || !name || !symbol || !quote}
        data-testid="launch-submit"
      >
        {writeButtonLabel(
          phase === "awaiting_wallet" || isPending ? "Signing…" : path === "instant" ? "Launch Instant" : "Open Fair Launch",
        )}
      </Button>
    </div>
  );
}
