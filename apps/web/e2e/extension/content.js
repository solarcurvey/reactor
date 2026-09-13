window.addEventListener("message", (ev) => {
  if (ev.source !== window || ev.data?.target !== "reactor-e2e-content") return;
  chrome.runtime.sendMessage({ type: "rpc", id: ev.data.id, method: ev.data.method, params: ev.data.params }, (res) => {
    window.postMessage({ target: "reactor-e2e-inpage", ...res }, "*");
  });
});

const port = chrome.runtime.connect({ name: "reactor-e2e" });
port.onMessage.addListener((msg) => {
  window.postMessage({ target: "reactor-e2e-inpage-event", ...msg }, "*");
});
