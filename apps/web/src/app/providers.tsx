"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { LiveToasts } from "@/components/live-toasts";
import { arcLocal } from "@/lib/chain";
import { createAppQueryClient } from "@/lib/query";
import { LiveCacheProvider } from "@/lib/sse";

const config = createConfig({
  chains: [arcLocal],
  connectors: [injected()],
  transports: {
    [arcLocal.id]: http(arcLocal.rpcUrls.default.http[0]),
  },
  ssr: true,
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => createAppQueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={client}>
        <LiveCacheProvider>
          {children}
          <LiveToasts />
        </LiveCacheProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
