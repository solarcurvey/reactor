const ANVIL0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ANVIL1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

const state = {
  locked: false,
  connected: false,
  selected: 0,
  accounts: [ANVIL0, ANVIL1],
  chainId: 5042002,
  pending: null,
  txs: [],
  nonce: 0,
};

const waiters = new Map();
const ports = new Set();

function account() {
  return state.accounts[state.selected];
}

function nextHash() {
  state.nonce += 1;
  return `0x${state.nonce.toString(16).padStart(64, "0")}`;
}

async function openNotification() {
  try {
    await chrome.windows.create({
      url: chrome.runtime.getURL("notification.html"),
      type: "popup",
      focused: true,
      width: 380,
      height: 560,
    });
  } catch {
    /* headless may ignore windows.create — tests open notification.html */
  }
}

function needsApproval(method) {
  return (
    method === "eth_requestAccounts" ||
    method === "eth_sendTransaction" ||
    method === "personal_sign" ||
    method === "eth_signTypedData_v4"
  );
}

function broadcast(payload) {
  for (const port of ports) {
    try {
      port.postMessage(payload);
    } catch {
      ports.delete(port);
    }
  }
}

function resolvePending(ok) {
  const p = state.pending;
  state.pending = null;
  if (!p) return;
  const waiter = waiters.get(p.id);
  waiters.delete(p.id);
  if (!waiter) return;
  if (!ok) {
    waiter({ error: { code: 4001, message: "User rejected the request." } });
    return;
  }
  if (p.method === "eth_requestAccounts") {
    if (state.locked) {
      waiter({ error: { code: 4100, message: "Wallet is locked." } });
      return;
    }
    state.connected = true;
    waiter({ result: [account()] });
    broadcast({ event: "connect", params: { chainId: `0x${state.chainId.toString(16)}` } });
    broadcast({ event: "accountsChanged", params: [account()] });
    return;
  }
  if (p.method === "eth_sendTransaction") {
    const hash = nextHash();
    const tx = p.params?.[0] || {};
    state.txs.push({ to: String(tx.to || "").toLowerCase(), data: tx.data || "0x", hash });
    waiter({ result: hash });
    return;
  }
  waiter({ result: `0x${"cd".repeat(65)}` });
}

async function handleRpc(msg) {
  const { id, method, params } = msg;
  const chainHex = `0x${state.chainId.toString(16)}`;
  if (method === "eth_chainId") return { id, result: chainHex };
  if (method === "net_version") return { id, result: String(state.chainId) };
  if (method === "eth_blockNumber") return { id, result: "0x10" };
  if (method === "eth_gasPrice" || method === "eth_maxPriorityFeePerGas") return { id, result: "0x3b9aca00" };
  if (method === "eth_estimateGas") return { id, result: "0x30d40" };
  if (method === "eth_getCode") return { id, result: "0x" };
  if (method === "eth_call") return { id, result: `0x${"00".repeat(32)}` };
  if (method === "eth_getBalance") return { id, result: `0x${(10n ** 24n).toString(16)}` };
  if (method === "eth_accounts") return { id, result: state.connected && !state.locked ? [account()] : [] };
  if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") {
    const idn = Number.parseInt(String(params?.[0]?.chainId || chainHex), 16);
    state.chainId = idn;
    broadcast({ event: "chainChanged", params: `0x${idn.toString(16)}` });
    return { id, result: null };
  }
  if (needsApproval(method)) {
    if (method !== "eth_requestAccounts" && state.locked) {
      return { id, error: { code: 4100, message: "Wallet is locked." } };
    }
    state.pending = { id, method, params };
    void openNotification();
    const result = await new Promise((resolve) => {
      waiters.set(id, resolve);
    });
    return { id, ...result };
  }
  return { id, error: { code: -32601, message: `Unsupported ${method}` } };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "state") {
    sendResponse({ ...state, account: account() });
    return true;
  }
  if (msg?.type === "lock") {
    state.locked = true;
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.type === "unlock") {
    state.locked = false;
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.type === "switchAccount") {
    state.selected = Number(msg.index) || 0;
    broadcast({ event: "accountsChanged", params: state.connected ? [account()] : [] });
    sendResponse({ ok: true, account: account() });
    return true;
  }
  if (msg?.type === "setChain") {
    state.chainId = Number(msg.chainId);
    broadcast({ event: "chainChanged", params: `0x${state.chainId.toString(16)}` });
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.type === "approve") {
    resolvePending(true);
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.type === "reject") {
    resolvePending(false);
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.type === "rpc") {
    handleRpc(msg).then(sendResponse);
    return true;
  }
  return false;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "reactor-e2e") return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
});
