(() => {
  const listeners = new Map();
  const on = (event, handler) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
  };
  const removeListener = (event, handler) => listeners.get(event)?.delete(handler);
  const emit = (event, ...args) => {
    for (const h of listeners.get(event) ?? []) h(...args);
  };

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.data?.target !== "reactor-e2e-inpage-event") return;
    emit(ev.data.event, ev.data.params);
  });

  const provider = {
    isMetaMask: true,
    isRabby: true,
    isReactorE2e: true,
    on,
    addListener: on,
    removeListener,
    removeAllListeners: (e) => (e ? listeners.delete(e) : listeners.clear()),
    enable: () => provider.request({ method: "eth_requestAccounts" }),
    request: ({ method, params }) =>
      new Promise((resolve, reject) => {
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const onMsg = (ev) => {
          if (ev.source !== window || ev.data?.target !== "reactor-e2e-inpage" || ev.data.id !== id) return;
          window.removeEventListener("message", onMsg);
          if (ev.data.error) reject(ev.data.error);
          else resolve(ev.data.result);
        };
        window.addEventListener("message", onMsg);
        window.postMessage({ target: "reactor-e2e-content", id, method, params }, "*");
      }),
  };

  Object.defineProperty(window, "ethereum", { configurable: true, writable: true, value: provider });
  const announce = (name, rdns, uuid) => {
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: Object.freeze({
          info: { uuid, name, icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns },
          provider,
        }),
      }),
    );
  };
  const all = () => {
    announce("MetaMask", "io.metamask", "reactor-e2e-mm");
    announce("Rabby", "io.rabby", "reactor-e2e-rabby");
  };
  window.addEventListener("eip6963:requestProvider", all);
  all();
})();
