# Nested fees (honest)

> Official REACTOR legs charge **3.5% in quote**. Nested official hops stack. The UI must never collapse them into one “0.30%” Uniswap fee.

Official REACTOR legs charge **3.5% in quote**. User hops through official pools pay that on **each** official leg. Protocol vault hops (`ProtocolV4Adapter`) are fee-exempt and must not mint a new 2/1/0.5.

## Disclosure

`POST /quote` lists every official 3.5% leg separately. The UI must not collapse nested legs into one “0.30%” Uniswap fee. RouteGraph stores **proven** official pools only — it does not invent hopViaUsdc 0.30% edges.

## Example

Buy CAT with USDC while CAT is quoted in ZCAT and ZCAT is quoted in ZEC:

`USDC → ZEC (hopless 0.30% if that pool exists) → ZCAT (official 3.5%) → CAT (official 3.5%)`

The ticket shows both 3.5% legs. Valuation multiplies CAT/ZCAT × ZCAT/ZEC × ZEC/USD. Copying ZEC’s USD onto CAT is rejected.
