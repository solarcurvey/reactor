# Ticker registry

Global launch identity. Survives Factory V1/V2. Not owned by one factory.

- Normalize: uppercase `A–Z0–9`, max 10. Same rules in `Ticker.sol` and `packages/reactor/src/ticker.ts`.
- Successful launch → **24h** global lock via `claimOnLaunch`. Failed/expired auth does not squat.
- Reserved at deploy: CORE, REACTOR, USDC, ZEC, WBTC, EURC (`reserveTicker` / constructor `_reserve`). Separate from launched-token locks.
- `permanentlyLockTicker(ticker, token)`: Guardian only. Requires a **REACTOR-native** token from an authorized factory whose onchain ticker matches. `token == 0` is rejected (`ReservedSeparate`). Irreversible.

API: `GET /ticker/:ticker`.
