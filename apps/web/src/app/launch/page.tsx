"use client";

import { useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "viem/actions";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useQuotes } from "@/lib/hooks";
import { factory } from "@/lib/contracts";
import { parseUnitsSafe } from "@/lib/utils";

const STEPS = ["Token", "Earn", "Mode", "Confirm"] as const;

export default function LaunchPage() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const client = usePublicClient();
  const { data: quotes } = useQuotes();
  const { writeContractAsync, isPending } = useWriteContract();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [image, setImage] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [quote, setQuote] = useState<`0x${string}` | "">("");
  const [mode, setMode] = useState<"instant" | "fair">("instant");
  const [fdv, setFdv] = useState("80000");
  const [devBuy, setDevBuy] = useState("0");
  const [durationMin, setDurationMin] = useState("45");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = quotes?.find((q) => q.token.toLowerCase() === quote.toLowerCase());

  async function submit() {
    setError(null);
    if (!isConnected || !client || !selected) {
      setError("Connect a wallet and pick a quote asset.");
      return;
    }
    try {
      if (mode === "instant") {
        const hash = await writeContractAsync({
          ...factory,
          functionName: "instantLaunch",
          args: [
            {
              name,
              symbol: symbol.toUpperCase(),
              decimals: 18,
              supply: 0n,
              quote: selected.token,
              fdvQuoteRaw: parseUnitsSafe(fdv, selected.decimals),
              devBuyQuote: parseUnitsSafe(devBuy || "0", selected.decimals),
              image,
              description,
              website,
              twitter,
              telegram,
            },
          ],
        });
        await waitForTransactionReceipt(client, { hash });
        router.push("/");
      } else {
        const hash = await writeContractAsync({
          ...factory,
          functionName: "createFairLaunch",
          args: [
            {
              name,
              symbol: symbol.toUpperCase(),
              decimals: 18,
              supply: 0n,
              quote: selected.token,
              duration: BigInt(Math.floor(Number(durationMin) * 60)),
              auctionBps: 0,
              minRaise: 0n,
              image,
              description,
              website,
              twitter,
              telegram,
            },
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
    <div className="mx-auto max-w-2xl">
      <p className="text-xs uppercase tracking-[0.22em] text-cyan-200/80">Choose what your token earns</p>
      <h1 className="mt-2 text-3xl font-semibold">What should your token earn?</h1>
      <div className="mt-4 flex gap-2 text-xs uppercase tracking-wider text-zinc-500">
        {STEPS.map((s, i) => (
          <span key={s} className={i === step ? "text-cyan-200" : ""}>
            {i + 1}. {s}
          </span>
        ))}
      </div>

      {step === 0 && (
        <Card className="mt-6 space-y-3 p-5">
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
          <Input placeholder="Image URL (optional)" value={image} onChange={(e) => setImage(e.target.value)} />
          <textarea
            className="min-h-24 w-full rounded-xl border border-white/10 bg-black/30 p-3 text-sm"
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Input placeholder="Website" value={website} onChange={(e) => setWebsite(e.target.value)} />
          <Input placeholder="X / Twitter" value={twitter} onChange={(e) => setTwitter(e.target.value)} />
          <Input placeholder="Telegram" value={telegram} onChange={(e) => setTelegram(e.target.value)} />
        </Card>
      )}

      {step === 1 && (
        <Card className="mt-6 p-5">
          <h2 className="text-lg font-medium">What should your token earn?</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Holders earn the quote asset from official-pool volume. Pick the asset your market is priced in. Only
            curated quotes are shown.
          </p>
          <div className="mt-4 space-y-4">
            {Object.entries(
              (quotes ?? []).reduce<Record<string, typeof quotes>>((acc, q) => {
                const k = q.categoryLabel;
                (acc[k] ??= []).push(q);
                return acc;
              }, {}),
            ).map(([cat, qs]) => (
              <div key={cat}>
                <div className="mb-2 text-[11px] uppercase tracking-wider text-zinc-500">{cat}</div>
                <div className="grid gap-2">
                  {(qs ?? []).map((q) => (
                    <button
                      key={q.token}
                      onClick={() => setQuote(q.token)}
                      className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left ${
                        quote === q.token ? "border-cyan-300/50 bg-cyan-300/10" : "border-white/8 bg-black/20"
                      }`}
                    >
                      <span>
                        <span className="font-medium">{q.symbol}</span>
                        <span className="ml-2 text-xs text-zinc-500">{q.name}</span>
                      </span>
                      <span className="text-[11px] uppercase tracking-wider text-amber-200/80">TEST ASSET</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!quotes?.length && <p className="text-sm text-zinc-500">Loading quote registry…</p>}
          </div>
        </Card>
      )}

      {step === 2 && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            onClick={() => setMode("instant")}
            className={`rounded-2xl border p-5 text-left ${
              mode === "instant" ? "border-cyan-300/50 bg-cyan-300/10" : "border-white/8 bg-black/20"
            }`}
          >
            <div className="text-xs uppercase tracking-wider text-cyan-200">Instant</div>
            <div className="mt-1 font-medium">Market live immediately</div>
            <p className="mt-2 text-sm text-zinc-400">
              Uniswap v4 from trade #1. Hook on. Single-sided locked liquidity. Optional paid dev buy.
            </p>
          </button>
          <button
            onClick={() => setMode("fair")}
            className={`rounded-2xl border p-5 text-left ${
              mode === "fair" ? "border-cyan-300/50 bg-cyan-300/10" : "border-white/8 bg-black/20"
            }`}
          >
            <div className="text-xs uppercase tracking-wider text-cyan-200">Batch Fair Launch</div>
            <div className="mt-1 font-medium">Pro-rata timed sale — not Uniswap CCA</div>
            <p className="mt-2 text-sm text-zinc-400">
              50/50 hard-locked: half to bidders, half locked as official LP. 0% REACTOR charge during the sale.
              Clearing price becomes the official pool start price.
            </p>
          </button>
        </div>
      )}

      {step === 3 && (
        <Card className="mt-6 space-y-3 p-5 text-sm">
          <Row k="Name" v={`${name} ($${symbol.toUpperCase()})`} />
          <Row k="Quote" v={selected ? `${selected.symbol} · ${selected.categoryLabel}` : "—"} />
          <Row k="Mode" v={mode === "instant" ? "Instant launch" : "Batch Fair Launch"} />
          <Row k="Supply" v="1,000,000,000 · 18 decimals · mint once" />
          <Row k="Official pool" v="0% LP fee · 3% quote charge (2% holders / 1% CORE)" />
          <Row k="Liquidity" v="Locked in ReactorLiquidityVault — no withdraw" />
          {mode === "instant" && (
            <>
              <label className="block text-xs uppercase tracking-wider text-zinc-500">Starting FDV ({selected?.symbol})</label>
              <Input value={fdv} onChange={(e) => setFdv(e.target.value)} />
              <label className="block text-xs uppercase tracking-wider text-zinc-500">Paid dev buy (not free allocation)</label>
              <Input value={devBuy} onChange={(e) => setDevBuy(e.target.value)} />
            </>
          )}
          {mode === "fair" && (
            <>
              <label className="block text-xs uppercase tracking-wider text-zinc-500">Auction length (minutes)</label>
              <Input value={durationMin} onChange={(e) => setDurationMin(e.target.value)} />
              <Row k="Auction share" v="50% to bidders · 50% locked as LP (default)" />
              <Row k="During auction" v="0% REACTOR charge" />
            </>
          )}
          <button className="text-xs text-zinc-500 underline" onClick={() => setShowAdvanced((s) => !s)}>
            {showAdvanced ? "Hide" : "Advanced"} settings
          </button>
          {showAdvanced && (
            <p className="text-xs text-zinc-500">
              Economics are immutable after launch. A different split requires a V2 factory. External pools are allowed
              and uncharged.
            </p>
          )}
        </Card>
      )}

      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}

      <div className="mt-6 flex justify-between">
        <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          Back
        </Button>
        {step < 3 ? (
          <Button
            onClick={() => setStep((s) => s + 1)}
            disabled={
              (step === 0 && (!name || !symbol)) ||
              (step === 1 && !quote)
            }
          >
            Continue
          </Button>
        ) : (
          <Button onClick={submit} disabled={isPending || !isConnected}>
            {isPending ? "Signing…" : "Sign launch"}
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/6 py-2">
      <span className="text-zinc-500">{k}</span>
      <span className="text-right text-zinc-100">{v}</span>
    </div>
  );
}
