"use client";

import { useEffect, useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "viem/actions";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useQuotes } from "@/lib/hooks";
import { factory, erc20, launchAbi } from "@/lib/contracts";
import { INDEXER_URL } from "@/lib/chain";
import { parseUnitsSafe } from "@/lib/utils";

export default function LaunchPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const client = usePublicClient();
  const { data: quotes } = useQuotes();
  const { writeContractAsync, isPending } = useWriteContract();
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
  const [tickerStatus, setTickerStatus] = useState<string>("");

  const selected = quotes?.find((q) => q.token.toLowerCase() === quote.toLowerCase());

  useEffect(() => {
    const raw = symbol.trim();
    if (!raw) {
      setTickerStatus("");
      return;
    }
    let cancelled = false;
    fetch(`${INDEXER_URL}/ticker/${encodeURIComponent(raw)}`)
      .then((r) => r.json())
      .then((j: { ticker?: string; reserved?: boolean; available?: boolean; error?: string }) => {
        if (cancelled) return;
        if (j.error) setTickerStatus(j.error);
        else if (j.reserved) setTickerStatus(`${j.ticker} is reserved`);
        else if (j.available === false) setTickerStatus(`${j.ticker} is locked`);
        else setTickerStatus(`${j.ticker} available · 24h lock on success`);
      })
      .catch(() => {
        if (!cancelled) setTickerStatus("Ticker status offline");
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  async function authorizeLaunch(quoteAddr: `0x${string}`, ticker: string, mode: "instant" | "fair") {
    const admit = await fetch(`${(await import("@/lib/chain")).INDEXER_URL}/launch/admit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticker, quote: quoteAddr, wallet: address, name }),
    }).catch(() => null);
    const admitted = admit ? ((await admit.json()) as { decision?: string; reasons?: string[]; ticker?: string }) : null;
    if (admitted?.decision === "DENY") throw new Error(admitted.reasons?.join(", ") || "Launch denied");
    const res = await fetch("/api/launch-pricing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quote: quoteAddr, creator: address, ticker, mode }),
    });
    const body = (await res.json()) as {
      needsAuth?: boolean;
      ticker?: string;
      auth?: {
        factory: `0x${string}`;
        creator: `0x${string}`;
        quote: `0x${string}`;
        quoteDecimals: number;
        virtualQuote0: string;
        curveConfig: `0x${string}`;
        tickerHash: `0x${string}`;
        authId: `0x${string}`;
        deadline: string;
      };
      signature?: `0x${string}`;
      error?: string;
    };
    if (!res.ok || !body.auth || !body.signature) {
      throw new Error(body.error ?? "Launch authorization unavailable");
    }
    return {
      auth: {
        factory: body.auth.factory,
        creator: body.auth.creator,
        quote: body.auth.quote,
        quoteDecimals: body.auth.quoteDecimals,
        virtualQuote0: BigInt(body.auth.virtualQuote0),
        curveConfig: body.auth.curveConfig,
        tickerHash: body.auth.tickerHash,
        authId: body.auth.authId,
        deadline: BigInt(body.auth.deadline),
      },
      signature: body.signature,
      ticker: body.ticker ?? ticker,
    };
  }

  async function submit() {
    setError(null);
    if (!isConnected || !client || !selected || !address) {
      setError("Connect a wallet and pick a quote asset.");
      return;
    }
    try {
      const params = {
        name,
        symbol: symbol.toUpperCase(),
        decimals: 18,
        supply: 0n,
        quote: selected.token,
        fdvQuoteRaw: 0n,
        devBuyQuote: parseUnitsSafe(devBuy || "0", selected.decimals),
        image,
        description,
        website: "",
        twitter: "",
        telegram: "",
      };
      const priced = await authorizeLaunch(selected.token, params.symbol, path);
      params.symbol = priced.ticker;
      if (path === "instant") {
        if (params.devBuyQuote > 0n) {
          const allowance = (await client.readContract({
            address: selected.token,
            abi: erc20.abi,
            functionName: "allowance",
            args: [address, factory.address],
          })) as bigint;
          if (allowance < params.devBuyQuote) {
            const ah = await writeContractAsync({
              address: selected.token,
              abi: erc20.abi,
              functionName: "approve",
              args: [factory.address, params.devBuyQuote],
            });
            await waitForTransactionReceipt(client, { hash: ah });
          }
          const hash = await writeContractAsync({
            address: factory.address,
            abi: launchAbi,
            functionName: "launchAndBuy",
            args: [params, rewards, 1n, priced.auth, priced.signature],
          });
          await waitForTransactionReceipt(client, { hash });
        } else if (rewards) {
          const hash = await writeContractAsync({
            address: factory.address,
            abi: launchAbi,
            functionName: "instantLaunch",
            args: [params, priced.auth, priced.signature],
          });
          await waitForTransactionReceipt(client, { hash });
        } else {
          const hash = await writeContractAsync({
            address: factory.address,
            abi: launchAbi,
            functionName: "launchStandard",
            args: [params, priced.auth, priced.signature],
          });
          await waitForTransactionReceipt(client, { hash });
        }
        router.push("/");
      } else {
        const hash = await writeContractAsync({
          address: factory.address,
          abi: launchAbi,
          functionName: "createFairLaunch",
          args: [
            {
              name,
              symbol: priced.ticker,
              decimals: 18,
              supply: 0n,
              quote: selected.token,
              duration: BigInt(Math.floor(Number(durationMin) * 60)),
              auctionBps: 0,
              minRaise: 0n,
              image,
              description,
              website: "",
              twitter: "",
              telegram: "",
            },
            priced.auth,
            priced.signature,
          ],
        });
        await waitForTransactionReceipt(client, { hash });
        router.push("/");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Launch failed");
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-200/80">Instant · bonding → v4</p>
      <h1 className="mt-1 text-2xl font-semibold">Ignite a market</h1>
      <p className="mt-1 text-[13px] text-zinc-400">
        You pick image, name, ticker, description, quote, and Standard vs Rewards. Protocol owns supply, curve, FDV,
        and fees. Same Instant config for every launch.
      </p>

      <Card className="mt-4 space-y-3 p-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label htmlFor="launch-name" className="mb-1 block text-[11px] uppercase tracking-wider text-zinc-500">
              Name
            </label>
            <Input id="launch-name" name="name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="launch-ticker" className="mb-1 block text-[11px] uppercase tracking-wider text-zinc-500">
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
            {tickerStatus && <p className="mt-1 text-[11px] text-zinc-500">{tickerStatus}</p>}
          </div>
        </div>
        <div>
          <label htmlFor="launch-image" className="mb-1 block text-[11px] uppercase tracking-wider text-zinc-500">
            Image
          </label>
          <input
            id="launch-image-file"
            type="file"
            accept="image/*"
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
                const res = await fetch(`${INDEXER_URL}/upload`, { method: "POST", body: file });
                const body = (await res.json()) as { publicUrl?: string; uri?: string; error?: string };
                if (!res.ok) throw new Error(body.error ?? "upload failed");
                setImage(body.publicUrl ?? body.uri ?? "");
              } catch (err) {
                setError(err instanceof Error ? err.message : "upload failed — no base64 onchain");
              }
            }}
          />
          <Input id="launch-image" name="image" placeholder="or paste image URL" value={image.startsWith("data:") ? "" : image} onChange={(e) => setImage(e.target.value)} />
          {image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className="mt-2 h-16 w-16 rounded-lg object-cover" />
          )}
        </div>
        <div>
          <label htmlFor="launch-description" className="mb-1 block text-[11px] uppercase tracking-wider text-zinc-500">
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

        <div className="text-[11px] uppercase tracking-wider text-zinc-500" id="quote-asset-label">
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
                <span className="ml-2 text-xs text-zinc-500">{q.name}</span>
              </span>
              <span className="text-[11px] uppercase tracking-wider text-cyan-100">EARNS {q.symbol}</span>
            </button>
          ))}
          {!quotes?.length && <p className="text-sm text-zinc-500">Loading quote registry…</p>}
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
            <label htmlFor="launch-devbuy" className="block text-[11px] uppercase tracking-wider text-zinc-500">
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
          className="text-[11px] text-zinc-500 underline"
          onClick={() => setPath((p) => (p === "instant" ? "fair" : "instant"))}
        >
          {path === "instant" ? "Use Batch Fair Launch instead" : "Back to Instant bonding"}
        </button>
        {path === "fair" && (
          <>
            <p className="text-[13px] text-zinc-400">
              Pro-rata timed sale — not CCA. 50/50 locked. 0% during the sale. Clearing price opens the official pool.
            </p>
            <label htmlFor="launch-duration" className="block text-[11px] uppercase tracking-wider text-zinc-500">
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
          #1. No creator FDV, supply, or fee knobs.
        </div>
      </Card>

      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      <Button className="mt-4 w-full" onClick={submit} disabled={isPending || !isConnected || !name || !symbol || !quote}>
        {isPending ? "Signing…" : path === "instant" ? "Launch Instant" : "Open Fair Launch"}
      </Button>
    </div>
  );
}
