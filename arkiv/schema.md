# Arkiv schema

Network: Rabdi testnet (chain id 7794095). Writer wallet: [`0x34CBC166F6680753Dc8E3E72e8dB4E04889Da298`](https://rabdi.explorer.arkiv.network/address/0x34CBC166F6680753Dc8E3E72e8dB4E04889Da298) (`ARKIV_WRITER_ADDRESS` in `.env`).

## Entity: `agent-payment-protection.merchant-reputation.v1`

One entity per merchant, created on the merchant's first scored call and patched afterwards (batched: at most one write per merchant every 2 seconds).

| Field | Type | Indexed | Meaning |
|---|---|---|---|
| `merchantId` | str | yes | Gateway merchant id, the key agents query by |
| `slug` | str | yes | Human-readable merchant slug |
| `score` | dec | yes | `round(100 * ok / total)`, written as `100` while under 5 calls |
| `totalCalls` | u64 | no | Calls that count for reputation (case C excluded) |
| `failedCalls` | u64 | no | Calls that failed an objective check |
| `updatedAt` | u64 | no | Unix seconds |

Note: the agent doesn't rank by the stored `score`. It works out its own rank from `totalCalls` and `failedCalls` (see how-you-use-arkiv.md) so new merchants don't start at a flat 100 or 0.

**Owner**: only the gateway's writer wallet. Readers filter with `.ownedBy(writer)` so a stranger cannot spoof a score by reusing the schema name.

**Expiration**: 180 days from each create; reputation that is not refreshed by activity ages out.

## Query we run (the demo agent, before paying)

```ts
arkiv.select({ $key: true, score: true, totalCalls: true, failedCalls: true })
  .from(MerchantReputation)
  .where(eq("merchantId", "<merchant id>"))
  .ownedBy("0x34CBC166F6680753Dc8E3E72e8dB4E04889Da298")
  .fetch();
```

Code: `apps/gateway/src/chain/arkiv.ts` (write), `apps/demo-agent/src/index.ts` (read).
