import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";
import { attachConsoleGate } from "./console-gate";
import { INDEXER_URL } from "./constants.mjs";

/** Well-known Anvil accounts. Public test identities only — no private keys are loaded. */
export const ANVIL_ACCOUNT_0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
export const ANVIL_ACCOUNT_1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
export const LOCAL_CHAIN_ID = 5042002;

export type WalletOptions = {
  chainId?: number;
  rejectConnect?: boolean;
  rejectTx?: boolean;
  locked?: boolean;
  holdTx?: boolean;
};

export type RecordedTx = {
  from: string;
  to: string;
  data: string;
  value: string;
  hash: string;
};

declare global {
  interface Window {
    __reactorE2e?: {
      txs: RecordedTx[];
      requests: { method: string }[];
      pendingCount: number;
      setRejectTx: (v: boolean) => void;
      setChainId: (id: number) => void;
      setHoldTx: (v: boolean) => void;
      switchAccount: (index: number) => string;
      disconnect: () => void;
      lock: () => void;
      unlock: () => void;
      approvePending: () => string | null;
      rejectPending: () => void;
      setInsufficientFunds: (v: boolean) => void;
    };
  }
}

export async function resetMock(request: APIRequestContext, body: Record<string, unknown> = { reset: true }) {
  await request.post(`${INDEXER_URL}/e2e/control`, { data: body });
}

export async function installEip1193(page: Page, opts: WalletOptions = {}) {
  await page.addInitScript(
    ({ account0, account1, chainId, rejectConnect, rejectTx, locked, holdTx }) => {
      const STORE = "reactor.e2e.wallet";
      const load = () => {
        const base = {
          chainId,
          connected: false,
          rejectConnect,
          rejectTx,
          locked,
          holdTx,
          selected: 0,
          accounts: [account0, account1],
          insufficientFunds: false,
          txs: [],
          requests: [],
        };
        try {
          return Object.assign(base, JSON.parse(sessionStorage.getItem(STORE) || "{}"));
        } catch {
          return base;
        }
      };
      const save = (s) => sessionStorage.setItem(STORE, JSON.stringify(s));

      const listeners = new Map();
      const on = (event, handler) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(handler);
      };
      const removeListener = (event, handler) => {
        listeners.get(event)?.delete(handler);
      };
      const emit = (event, ...args) => {
        for (const h of listeners.get(event) ?? []) h(...args);
      };

      let nonce = 0;
      const nextHash = () => {
        nonce += 1;
        return `0x${nonce.toString(16).padStart(64, "0")}`;
      };
      const pending = [];

      const accountOf = (s) => s.accounts[s.selected] || s.accounts[0];

      const provider = {
        isMetaMask: true,
        isRabby: true,
        isReactorE2e: true,
        on,
        addListener: on,
        removeListener,
        removeAllListeners: (event) => {
          if (event) listeners.delete(event);
          else listeners.clear();
        },
        enable: () => provider.request({ method: "eth_requestAccounts" }),
        request: async ({ method, params }) => {
          const state = load();
          state.requests.push({ method });
          save(state);
          const chainHex = `0x${Number(state.chainId).toString(16)}`;
          const account = accountOf(state);

          if (method === "eth_chainId" || method === "net_version") {
            return method === "eth_chainId" ? chainHex : String(state.chainId);
          }
          if (method === "eth_blockNumber") return "0x10";
          if (method === "eth_gasPrice" || method === "eth_maxPriorityFeePerGas") return "0x3b9aca00";
          if (method === "eth_estimateGas") return "0x30d40";
          if (method === "eth_getCode") return "0x";
          if (method === "eth_call") return `0x${"00".repeat(32)}`;
          if (method === "eth_getBalance") return `0x${(10n ** 24n).toString(16)}`;
          if (method === "eth_accounts") {
            return state.connected && !state.locked ? [account] : [];
          }
          if (method === "eth_requestAccounts") {
            if (state.rejectConnect) {
              throw { code: 4001, message: "User rejected the request." };
            }
            if (state.locked) {
              throw { code: 4100, message: "The requested account and/or method has not been authorized by the user." };
            }
            state.connected = true;
            save(state);
            emit("connect", { chainId: chainHex });
            emit("accountsChanged", [account]);
            return [account];
          }
          if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") {
            const next = params?.[0] || {};
            const id = Number.parseInt(String(next.chainId || chainHex), 16);
            state.chainId = id;
            save(state);
            emit("chainChanged", `0x${id.toString(16)}`);
            return null;
          }
          if (method === "eth_sendTransaction") {
            if (state.locked) {
              throw { code: 4100, message: "The requested account and/or method has not been authorized by the user." };
            }
            if (state.rejectTx) {
              throw { code: 4001, message: "User rejected the request." };
            }
            if (state.insufficientFunds) {
              throw { code: -32000, message: "insufficient funds for gas * price + value" };
            }
            const tx = params?.[0] || {};
            const record = (hash) => {
              state.txs.push({
                from: tx.from || account,
                to: String(tx.to || "").toLowerCase(),
                data: tx.data || "0x",
                value: tx.value || "0x0",
                hash,
              });
              save(state);
              return hash;
            };
            if (state.holdTx) {
              return new Promise((resolve, reject) => {
                pending.push({ resolve, reject, record });
              });
            }
            return record(nextHash());
          }
          if (
            method === "personal_sign" ||
            method === "eth_sign" ||
            method === "eth_signTypedData" ||
            method === "eth_signTypedData_v4"
          ) {
            if (state.rejectTx) throw { code: 4001, message: "User rejected the request." };
            if (state.locked) throw { code: 4100, message: "Unauthorized." };
            return `0x${"cd".repeat(65)}`;
          }
          if (method === "wallet_watchAsset" || method === "wallet_requestPermissions") return true;
          throw { code: -32601, message: `Unsupported method: ${method}` };
        },
      };

      Object.defineProperty(window, "ethereum", { configurable: true, writable: true, value: provider });

      const announce = () => {
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: Object.freeze({
              info: {
                uuid: "reactor-e2e-wallet",
                name: "MetaMask",
                icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
                rdns: "io.metamask",
              },
              provider,
            }),
          }),
        );
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: Object.freeze({
              info: {
                uuid: "reactor-e2e-rabby",
                name: "Rabby",
                icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
                rdns: "io.rabby",
              },
              provider,
            }),
          }),
        );
      };
      window.addEventListener("eip6963:requestProvider", announce);
      announce();

      window.__reactorE2e = {
        get txs() {
          return load().txs;
        },
        get requests() {
          return load().requests;
        },
        get pendingCount() {
          return pending.length;
        },
        setRejectTx(v) {
          const s = load();
          s.rejectTx = v;
          save(s);
        },
        setHoldTx(v) {
          const s = load();
          s.holdTx = v;
          save(s);
        },
        setChainId(id) {
          const s = load();
          s.chainId = id;
          save(s);
          emit("chainChanged", `0x${Number(id).toString(16)}`);
        },
        switchAccount(index) {
          const s = load();
          s.selected = index;
          save(s);
          const next = s.accounts[index];
          emit("accountsChanged", s.connected ? [next] : []);
          return next;
        },
        disconnect() {
          const s = load();
          s.connected = false;
          save(s);
          emit("accountsChanged", []);
          emit("disconnect", { code: 4900, message: "disconnect" });
        },
        lock() {
          const s = load();
          s.locked = true;
          save(s);
          emit("accountsChanged", []);
        },
        unlock() {
          const s = load();
          s.locked = false;
          save(s);
          if (s.connected) emit("accountsChanged", [accountOf(s)]);
        },
        approvePending() {
          const p = pending.shift();
          if (!p) return null;
          const hash = nextHash();
          p.record(hash);
          p.resolve(hash);
          return hash;
        },
        rejectPending() {
          const p = pending.shift();
          if (!p) return;
          p.reject({ code: 4001, message: "User rejected the request." });
        },
        setInsufficientFunds(v) {
          const s = load();
          s.insufficientFunds = v;
          save(s);
        },
      };
    },
    {
      account0: ANVIL_ACCOUNT_0,
      account1: ANVIL_ACCOUNT_1,
      chainId: opts.chainId ?? LOCAL_CHAIN_ID,
      rejectConnect: Boolean(opts.rejectConnect),
      rejectTx: Boolean(opts.rejectTx),
      locked: Boolean(opts.locked),
      holdTx: Boolean(opts.holdTx),
    },
  );
}

export async function recordedTxs(page: Page): Promise<RecordedTx[]> {
  return page.evaluate(() => window.__reactorE2e?.txs ?? []);
}

export async function connectWallet(page: Page) {
  const connected = page.getByTestId("wallet-menu-trigger");
  if (await connected.isVisible().catch(() => false)) return;
  const connect = page.getByTestId("wallet-connect").or(page.getByRole("button", { name: /Connect wallet/i })).first();
  await expect(connect).toBeVisible({ timeout: 20_000 });
  await expect(connect).toBeEnabled();
  await connect.click();
  await expect(connected).toBeVisible({ timeout: 15_000 });
}

export async function disconnectWallet(page: Page) {
  const header = page.getByTestId("wallet-disconnect");
  if (await header.isVisible().catch(() => false)) {
    await header.click();
    return;
  }
  await page.getByTestId("wallet-menu-trigger").click();
  await expect(page.getByTestId("wallet-disconnect")).toBeVisible();
  await page.getByTestId("wallet-disconnect").click();
}

/** Mobile viewports can leave Quote / the USDC-route label over Confirm after scroll. */
export async function clickTradeAction(page: Page, name: RegExp) {
  const btn = page.getByRole("button", { name });
  await expect(btn).toBeVisible();
  await btn.scrollIntoViewIfNeeded();
  try {
    await btn.click({ timeout: 8_000 });
  } catch {
    await btn.click({ force: true });
  }
}

export async function quoteAndConfirm(page: Page, side: "buy" | "sell") {
  if (side === "sell") {
    await clickTradeAction(page, /^sell$/i);
  } else {
    await clickTradeAction(page, /^buy$/i);
  }
  await page.getByPlaceholder("0.0").fill("1");
  await clickTradeAction(page, /^Quote$/);
  await expect(page.locator("body")).toContainText(/Quoted out:\s+\d/i, { timeout: 15_000 });
  await clickTradeAction(page, new RegExp(`Confirm ${side}`, "i"));
  await expect(page.getByText(/tx 0x/i)).toBeVisible({ timeout: 20_000 });
}

export const test = base.extend<{ walletOptions: WalletOptions }>({
  walletOptions: [{}, { option: true }],
  page: async ({ page, walletOptions, request }, use, testInfo) => {
    await resetMock(request);
    await installEip1193(page, walletOptions);
    const gate = attachConsoleGate(page);
    await use(page);
    await gate.assertClean(testInfo, page);
  },
});

export { expect };
