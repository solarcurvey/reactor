function refresh() {
  chrome.runtime.sendMessage({ type: "state" }, (s) => {
    const status = document.getElementById("status");
    const meta = document.getElementById("meta");
    const locked = document.getElementById("locked");
    locked.checked = Boolean(s.locked);
    if (!s.pending) {
      status.textContent = s.locked ? "Wallet locked" : "No pending request";
      meta.textContent = `account ${s.account} · chain ${s.chainId}`;
      return;
    }
    status.textContent = s.pending.method === "eth_requestAccounts" ? "Connect requested" : `Signature: ${s.pending.method}`;
    meta.textContent = JSON.stringify(s.pending.params ?? [], null, 2);
  });
}

document.getElementById("confirm").onclick = () => chrome.runtime.sendMessage({ type: "approve" }, refresh);
document.getElementById("reject").onclick = () => chrome.runtime.sendMessage({ type: "reject" }, refresh);
document.getElementById("unlock").onclick = () => chrome.runtime.sendMessage({ type: "unlock" }, refresh);
document.getElementById("locked").onchange = (e) => {
  chrome.runtime.sendMessage({ type: e.target.checked ? "lock" : "unlock" }, refresh);
};
document.getElementById("acct0").onclick = () => chrome.runtime.sendMessage({ type: "switchAccount", index: 0 }, refresh);
document.getElementById("acct1").onclick = () => chrome.runtime.sendMessage({ type: "switchAccount", index: 1 }, refresh);

refresh();
setInterval(refresh, 250);
