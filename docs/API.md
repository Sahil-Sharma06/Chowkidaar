# Chowkidaar API reference

Chowkidaar is a bond-backed refund gateway for AI agents paying over x402 on Hedera. This document covers every HTTP endpoint the gateway exposes, for three audiences:

| Audience | Prefix | Auth |
|---|---|---|
| **Agents** (any x402 client) | `/v1` | `x-agent-key` header + x402 payment |
| **Owners and merchants** (the web app, or your own tooling) | `/api` | session cookie (World ID Agent Pass) |
| **Anyone** (explorers, judges, other agents) | `/api/public` | none |

## Base URL

All paths below are relative to the gateway's public origin. Replace `{GATEWAY}` with wherever the gateway is deployed:

```
{GATEWAY} = https://gateway.your-domain.example     # hosted
{GATEWAY} = http://localhost:4000                   # local `npm run dev`
```

The web app proxies `/api/*` to the gateway on the same origin, so when you are talking to the web app's origin you can drop the gateway host and call `/api/...` directly; agents should always use `{GATEWAY}/v1/...`.

`GET {GATEWAY}/api/public/config` tells you everything environment-specific (network, USDC token, vault account, HCS topic, fee, penalty), so clients never need to hard-code them.

## Conventions

- JSON in, JSON out. Send `content-type: application/json`.
- **Money is micro-USDC as a string** (6 decimals): `"100000"` = 0.10 USDC. Request bodies that take money (caps, prices, withdrawals) use micro-USDC **integers**.
- Hedera accounts are `0.0.12345`. Transaction ids are returned as the SDK prints them (`0.0.x@seconds.nanos`); the HashScan form is `0.0.x-seconds-nanos`.
- Errors are `{"error": "<code>", "detail"?: "..."}` with an appropriate status. Codes are stable strings listed per endpoint.
- Timestamps are Unix milliseconds unless noted (`updatedAt` on Arkiv is seconds).
- Rate limit: `/v1/call/*` is limited to 60 requests per minute per agent key (`429 rate_limited`).

---

## 1. Agent API (`/v1`)

This is the only part an agent needs. It works with **any x402 client**; the demo agent uses `@x402/fetch` + `@x402/hedera`.

### `POST /v1/call/{slug}` — the protected call

Pay a merchant through the gateway. The gateway enforces the owner's policy, takes the payment over x402, pays the merchant, calls it, checks the response, and either returns the data or refunds the agent.

**Headers**

| Header | Required | Meaning |
|---|---|---|
| `x-agent-key` | yes | The agent's API key (`apk_...`), shown once when the agent is created. |
| `x-approval-id` | no | An approval id the owner granted for a call that was previously held (see `202`). |
| `payment-signature` | by the x402 client | Added automatically by any x402 client after the `402`. |

**Body**: anything JSON. It is forwarded verbatim to the merchant.

**Flow**

1. First request (unpaid) → `402 Payment Required` with the x402 `payment-required` header: `amount` = price + fee, `asset` = USDC, `payTo` = gateway account, `extra.paymentFlow = "upfront"`. Policy is checked *before* the 402, so a blocked call never gets a quote.
2. The x402 client signs a Hedera USDC transfer and retries with `payment-signature`.
3. The facilitator settles the transfer; the gateway runs the pipeline; one of the responses below is returned. The `payment-response` header carries the settlement (`transaction` = the agent's HashScan tx).

**Responses**

`200 OK` — delivered. The merchant keeps the price; the gateway keeps the fee.
```json
{ "outcome": "delivered", "paymentId": "pay_...", "data": { ...merchant JSON... }, "receiptUrl": "{WEB}/receipts/pay_..." }
```

`502 Bad Gateway` — the merchant failed an objective check. **A refund is already queued**; poll `GET /v1/payments/{paymentId}` or the public receipt.
```json
{
  "outcome": "refund_pending", "paymentId": "pay_...",
  "reason": "http_error | timeout | empty_body | bad_format | price_mismatch | network_error | gateway_error",
  "detail": "HTTP 500", "faultCase": "A | B | C",
  "refundAmount": "100000", "agentPaid": "102000",
  "statusUrl": "{GATEWAY}/v1/payments/pay_...", "receiptUrl": "{WEB}/receipts/pay_..."
}
```
`bad_format` covers both "not JSON" and "does not match the merchant's registered JSON Schema" (`detail` says which). Fault cases: **A** merchant was paid and failed → refund of the price from the merchant's bond, bond slashed price + penalty. **B** merchant failed before being paid → refund of the price by the gateway, no slash. **C** our fault → refund of price + fee, nothing counted against the merchant.

`202 Accepted` — held for the owner. The amount is above the agent's approval threshold. Nothing was paid.
```json
{ "error": "approval_required", "approvalId": "apr_...", "expiresAt": 1793926000000 }
```
Once the owner approves (web app, World ID step-up), repeat the call with `x-approval-id: apr_...` within 15 minutes.

`401 / 403` — blocked by policy before any payment. `error` is one of:

| Code | Status | Meaning |
|---|---|---|
| `invalid_agent_key` | 401 | Unknown or rotated key |
| `agent_paused` | 403 | Owner paused the agent |
| `merchant_not_available` | 403 | No live merchant with that slug |
| `per_call_cap_exceeded` | 403 | price + fee above the per-call cap |
| `daily_cap_exceeded` | 403 | Today's spend + this call above the daily cap |
| `merchant_not_allowed` | 403 | Allowlist is on and the merchant is not on it |
| `merchant_low_reputation` | 403 | Merchant score below the agent's minimum (merchants with fewer than 5 calls are "new" and pass) |
| `merchant_not_covered` | 403 | Merchant's available bond cannot cover price + penalty |

`409 settlement_reused` — the same settlement was presented twice. `429 rate_limited`.

**Example (TypeScript, exactly what the demo agent runs)**

```ts
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";

const signer = createClientHederaSigner(AGENT_ACCOUNT_ID, PrivateKey.fromStringDer(AGENT_KEY), { network: "hedera:testnet" });
const client = x402Client.fromConfig({
  schemes: [{ network: "hedera:*", client: new ExactHederaScheme(signer) }],
  spendControls: { maxAmountPerPayment: "$5" },
});
const pay = wrapFetchWithPayment(fetch, client);

const res = await pay(`${GATEWAY}/v1/call/good-data`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-agent-key": AGENT_API_KEY },
  body: JSON.stringify({ query: "hbar-price" }),
});
const body = await res.json();
if (res.status === 200) use(body.data);
else if (res.status === 502) console.log("refund on its way:", body.refundAmount, body.receiptUrl);
else if (res.status === 202) console.log("ask the owner to approve", body.approvalId);
else console.log("blocked:", body.error);
```

### `GET /v1/merchants/{slug}` — quote before paying

No auth. Returns the public merchant record plus the exact amount the agent will be charged.

```json
{
  "id": "mer_...", "slug": "good-data", "name": "HBAR Price Feed", "price": "100000", "fee": "2000", "total": "102000",
  "timeoutMs": 10000, "status": "live", "score": 100, "totalCalls": 12, "failedCalls": 0,
  "bondAvailable": "1200000", "covered": true, "arkivEntityKey": "0x..."
}
```
`404 not_found`.

### `GET /v1/agent` — who am I

Header `x-agent-key`. The agent behind the key, its limits and allowlist, for MCP hosts and SDKs:
```json
{ "id": "agt_...", "name": "Claude Desktop", "hederaAccountId": "0.0.x", "custodial": true, "status": "active",
  "perCallCap": "500000", "dailyCap": "5000000", "approvalThreshold": "250000", "minScore": 60, "allowlistOnly": true, "allowedMerchantIds": ["mer_..."], "spentToday": "102000" }
```

### `POST /v1/ask` — say what you want; the agent pays

Header `x-agent-key`. **Custodial agents only** (wallet held by the gateway); agents with their own key use `/v1/call` through an x402 client. Body `{ "query": "get me a burger", "approvalId"?: "apr_...", "slug"?: "burgerbot" }`.

The gateway matches the request against what merchants declared about themselves (category, keywords, name), drops any that policy would reject, ranks the rest by Arkiv score (merchants under 5 calls count as new), pays the first over x402 and returns:
```json
{
  "outcome": "delivered | refund_pending | held | blocked | error | no_merchant",
  "intent": { "words": ["burger"], "categories": ["food"] },
  "scoreSource": "arkiv | gateway",
  "merchant": { "slug": "burgerbot", "name": "BurgerBot Kitchen", "category": "food", "price": "100000", "total": "102000", "score": null, "matched": ["burger"], "eligible": true, "why": [] },
  "candidates": [ { "...": "every live merchant with matched words, eligible flag and why: no_match | not_allowed | not_covered | above_cap | low_score" } ],
  "status": 200, "body": { "...": "the raw /v1/call response (data, or paymentId/reason/refundAmount, or approvalId)" },
  "agentTx": "0.0.x@...", "error": null, "webOrigin": "https://..."
}
```
This is what the web console and the MCP server (`packages/mcp`, tool `ask`) call.

### `GET /v1/payments/{paymentId}` — status of one of your calls

Header `x-agent-key`. Returns the full receipt (same shape as the public receipt, below). `401 invalid_agent_key`, `404 not_found` (not yours).

---

## 2. Public API (`/api/public`) — no auth

| Endpoint | Returns |
|---|---|
| `GET /api/public/config` | `{ network, usdc, gatewayAccount, vaultAccount, hcsTopicId, hashscan, facilitator, features: { world, arkiv, hcs, demoMode }, feeBps, penaltyBps }` |
| `GET /api/public/stats` | `{ protectedCalls, refunds, usdcRefunded, merchants }` |
| `GET /api/public/merchants` | Array of public merchant records (live, paused and needs_bond) |
| `GET /api/public/reputation` | Merchant reputation **read live from Arkiv**, filtered to entities owned by our writer: `{ source: "arkiv", enabled, writer, fetchedAt, entities: [{ key, merchantId, slug, score, totalCalls, failedCalls, updatedAt }] }`. `503 arkiv_unavailable` when Arkiv cannot be reached. |
| `GET /api/public/receipts?limit=20` | Newest receipts (max 100) |
| `GET /api/public/receipts/{paymentId}` | One receipt, `404 not_found` |

**Receipt**

```json
{
  "paymentId": "pay_...", "status": "calling | delivered | refund_pending | refunded | refund_failed",
  "reason": "http_error", "detail": "HTTP 500", "faultCase": "A",
  "merchant": { "id": "mer_...", "slug": "server-error", "name": "Crashy Quotes" },
  "agentAccount": "0.0.11332326", "agentName": "Trader",
  "money": { "price": "100000", "fee": "2000", "agentPaid": "102000", "merchantReceived": "100000", "refunded": "100000", "feeKept": "2000", "bondSlashed": "120000" },
  "tx": { "agent": "0.0.x@...", "merchant": "0.0.x@...", "refund": "0.0.x@..." },
  "links": { "agent": "https://hashscan.io/testnet/transaction/...", "merchant": "...", "refund": "...", "hcs": "https://hashscan.io/testnet/topic/0.0.11329161/message/13", "arkiv": "https://rabdi.explorer.arkiv.network/entity/0x..." },
  "hcs": { "topicId": "0.0.11329161", "sequence": 13 },
  "arkivEntityKey": "0x...", "responseHash": "sha256...", "httpStatus": 500, "latencyMs": 297,
  "createdAt": 1793926200000, "finishedAt": 1793926206000
}
```

Every receipt is also published as a message on the HCS topic (`links.hcs`), and the merchant's running score is written to Arkiv (`links.arkiv`), so anyone can verify a receipt without trusting this API.

---

## 3. Management API (`/api`) — session cookie

Used by the web app. All routes need a session cookie obtained through World ID Agent Pass (or the dev login in development). Role-gated routes answer `401 unauthenticated` without a session and `403 role_required` without the role.

### Auth and account

| Method, path | What it does |
|---|---|
| `GET /api/auth/config` | `{ agentPass, idkit, appId, environment, devLogin }` — which sign-in methods exist |
| `GET /api/world/oidc/start?purpose=login\|approval\|stepup&next=&approvalId=&scope=` | Redirects to World ID Agent Pass (OIDC, PKCE). `approval` and `stepup` force a fresh verification (`max_age=0`). |
| `GET /api/world/oidc/callback` | OIDC return URL; creates the session, approves the approval, or grants the step-up, then redirects back to the web app |
| `GET /api/world/rp-context` | IDKit request context (proof of human to become a merchant) |
| `POST /api/world/verify` `{ idkitResponse }` | Verifies the IDKit proof; one human = one merchant (`409 human_already_registered`) |
| `POST /api/dev-login` `{ name }` | Development only (`DEV_LOGIN=true` or no Agent Pass configured) |
| `GET /api/me` | `{ id, displayName, identity: "world-id"\|"dev", roles: { owner, merchant }, merchantVerified, merchant, agentCount, createdAt, lastLoginAt }` |
| `PATCH /api/me` `{ displayName }` | Rename |
| `POST /api/me/roles` `{ role: "owner"\|"merchant" }` | Turn on a role (`403 verification_required` for merchant without proof of human) |
| `GET /api/me/sessions` | Active sessions |
| `POST /api/logout?all=1` | Revoke this session (or all) |

**Step-up.** Sensitive actions (raising a cap, lowering the minimum score, turning the allowlist off, replacing an API key, withdrawing bond, approving a held payment) answer `403 { "error": "step_up_required", "scope": "agent:agt_x:limits" }`. The client sends the person through `/api/world/oidc/start?purpose=stepup&scope=...&next=...`, then repeats the request within a short window.

### Owner: agents (`role: owner`)

| Method, path | Body / notes |
|---|---|
| `GET /api/agents` | Your agents (see Agent record) |
| `POST /api/agents` | `{ name, hederaAccountId?, perCallCap, dailyCap, approvalThreshold, minScore? }` (micro-USDC integers). **Omit `hederaAccountId` and the gateway creates a custodial testnet wallet** for the agent. Returns `201` with the Agent record plus `apiKey` (shown once). `409 hedera_account_in_use`, `502 wallet_create_failed`. |
| `GET /api/agents/{id}` | One agent |
| `PATCH /api/agents/{id}` | Any of `name, perCallCap, dailyCap, approvalThreshold, minScore, allowlistOnly, status: "active"\|"paused"`. Loosening needs step-up. `400 daily_cap_below_per_call`, `400 approval_above_per_call`. |
| `POST /api/agents/{id}/rotate-key` | New API key (step-up). Returns the record plus `apiKey`. |
| `PUT /api/agents/{id}/allowlist` | `{ merchantIds: [] }` → `{ merchantIds }` |
| `GET /api/agents/{id}/payments` | Receipts for this agent (last 100) |
| `POST /api/agents/{id}/fund` | Demo mode only, custodial agents only: the gateway sends 0.5 testnet USDC to the wallet. `{ amount, txId, status }`. |
| `POST /api/agents/{id}/play` | Playground: `{ slug, body?, approvalId? }`. The custodial agent makes one real `/v1/call`; returns a `DemoRunResult` (timeline steps + outcome). |
| `POST /api/agents/{id}/ask` | Console: `{ query, approvalId?, slug? }`. The agent **chooses the merchant itself** (allowed, covered, within cap, highest Arkiv score; merchants with < 5 calls count as new), pays, and returns: `{ outcome: "delivered"\|"refund_pending"\|"held"\|"blocked"\|"error"\|"no_merchant", scoreSource: "arkiv"\|"gateway", merchant, candidates: [{ slug, name, price, total, score, eligible, why: ["not_allowed"\|"not_covered"\|"above_cap"\|"low_score"] }], status, body, agentTx }` where `body` is the raw `/v1/call` response. |
| `GET /api/owner/payments` | Receipts across all your agents (last 50) |
| `GET /api/owner/merchants` | Merchant catalog as the owner sees it |
| `GET /api/approvals?status=pending` | Held payments: `{ id, agentId, merchantId, amount, status, expiresAt, agentName, merchantName, merchantSlug, merchantScore }` |
| `POST /api/approvals/{id}/approve` | With Agent Pass configured this answers `403 { error: "step_up_required", via: "agent_pass" }`: approve through `/api/world/oidc/start?purpose=approval&approvalId=`. `409 already_decided`, `410 expired`. |
| `POST /api/approvals/{id}/reject` | Always allowed |

**Agent record**
```json
{ "id": "agt_...", "ownerId": "acct_...", "name": "Trader", "hederaAccountId": "0.0.11332326", "custodial": true,
  "perCallCap": 500000, "dailyCap": 5000000, "approvalThreshold": 250000, "minScore": 60, "allowlistOnly": true,
  "status": "active", "createdAt": 1793926000000, "spentToday": 104000, "allowedMerchantIds": ["mer_..."], "lastPaymentAt": 1793926300000 }
```

### Merchant: your service (`role: merchant`, one merchant per account)

| Method, path | Body / notes |
|---|---|
| `GET /api/merchants/me` | Your merchant: all fields plus `bond` (see Bond), `public`, `total`. `404 not_found` before registration. |
| `POST /api/merchants` | `{ name, slug, endpointUrl, payoutAccountId, price, timeoutMs?, responseSchema }`. `responseSchema` must be a JSON Schema with `type: "object"` and a non-empty `required`. Status starts at `testing`. `409 already_registered`, `409 slug_taken`, `400 bad_schema`, `400 <ssrf code>` for unsafe URLs. |
| `PATCH /api/merchants/{id}` | Any field above, or `status: "paused"\|"live"`. Config changes put the merchant back into `testing`. |
| `POST /api/merchants/{id}/test` | Unpaid reachability test: `{ passed, checks: { reachable, returns402, payoutMatches, assetMatches, priceMatches }, detail, merchant }`. Passing moves `testing → needs_bond` (or `live` if the bond already suffices). |
| `GET /api/merchants/{id}/bond` | Bond view plus `ledger: [{ id, type: "deposit"\|"slash"\|"withdraw", amount, txId, paymentId, createdAt }]` |
| `POST /api/merchants/{id}/bond/deposits` | `{ txId }` of a USDC transfer to the vault **with memo `bond:{merchantId}`**. Verified on the mirror node. `400 not_found_yet \| not_successful \| wrong_memo \| no_vault_credit`, `409 duplicate`. Returns `{ credited, ...bond, merchant }`. |
| `POST /api/merchants/{id}/bond/withdraw` | `{ amount }` (micro-USDC) up to `available` (step-up). Returns `{ withdrawn, txId, ...bond, merchant }`. `400 insufficient_available`, `502 transfer_failed`. A live merchant that drops below the minimum becomes `needs_bond`. |
| `GET /api/merchants/{id}/payments` | Receipts of calls to you (last 100) |

**Bond**
```json
{ "vaultAccount": "0.0.11329153", "token": "0.0.429274", "memo": "bond:mer_...",
  "balance": "1200000", "locked": "0", "available": "1200000", "minimum": "1200000", "perFailure": "120000", "failuresCovered": 10, "covered": true }
```
`minimum = 10 × (price + penalty)`; `perFailure = price + penalty` is reserved for the duration of every call and slashed on a case-A failure.

**Merchant status**: `draft → testing → needs_bond → live ⇄ paused`, `suspended`. Only `live` merchants receive calls.

---

## 4. Money rules (what the numbers mean)

| Rule | Default | Source |
|---|---|---|
| Protection fee | 2% of price (`FEE_BPS=200`) | `config.feeBps` |
| Penalty | 20% of price (`PENALTY_BPS=2000`) | `config.penaltyBps` |
| Agent pays | price + fee | `/v1/merchants/{slug}.total` |
| Bond reserved per call | price + penalty | `bond.perFailure` |
| Minimum bond to go live | 10 × (price + penalty) | `bond.minimum` |
| Case A refund / slash | agent gets price back; bond slashed price + penalty | receipt `money` |
| Case B refund | agent gets price back from the gateway; no slash | |
| Case C refund | agent gets price + fee back; not counted against the merchant | |
| Score | `round(100 × ok / total)`, published to Arkiv after every call; `null` ("new") below 5 calls | `/api/public/reputation` |
| Approval TTL | 15 minutes | `approvals.expiresAt` |

---

## 5. Where to verify things without this API

- **Payments and refunds**: every receipt links the agent, merchant and refund transactions on HashScan.
- **Receipts**: each one is a message on the HCS topic in `config.hcsTopicId` (`links.hcs`).
- **Reputation**: entities of schema `agent-payment-protection.merchant-reputation.v1` owned by `reputation.writer` on Arkiv (Rabdi testnet); `links.arkiv` opens the explorer. Any Arkiv client can query `.from(schema).where(eq("merchantId", id)).ownedBy(writer)`.
- **Bonds**: the vault account `config.vaultAccount`; deposits carry memo `bond:<merchantId>`, refunds `refund:<paymentId>`, withdrawals `withdraw:<merchantId>`.
