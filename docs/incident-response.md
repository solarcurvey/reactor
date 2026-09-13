# Incident response

Operator entry point for REACTOR-operated outages. **Not audited. No public mainnet.** Economics and Factory V1 are unchanged.

## Start here

| Incident | Playbook |
| --- | --- |
| Official-list refresh failure, stale dataset, suspected false positive, OFAC/geo-policy update, emergency disable of write assistance, evidence, restore | **[Sanctions runbook](/docs/sanctions-runbook)** |
| Screening freshness SLA, health fields, audit redaction, alert codes | [Sanctions ops](/docs/sanctions-ops) |
| Keeper / Top-10 / pricing consensus | [Keeper](/docs/keeper), [Valuation](/docs/valuation), watchdog `/pricing/health` |
| Browser / telemetry outage classes (when that branch is present) | [Trust](/docs/trust) |

## Standing rules

- Fail closed. Do not treat stale or unknown sanctions/geo data as clear.
- No automated override because a user complains.
- Do not deploy to Arc Mainnet (5042). Do not claim an audit.
- Preserve last-known-good. Partial refreshes must not replace it.
- Minimize personal data in tickets (hashed wallet, request id, dataset/policy versions).
