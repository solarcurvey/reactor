"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { arcLocal } from "@/lib/chain";

const config = createConfig({
  chains: [arcLocal],
  connectors: [injected()],
  transports: {
    [arcLocal.id]: http(arcLocal.rpcUrls.default.http[0]),
  },
  ssr: true,
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
