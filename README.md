# Agent Payment Protection

Bond-backed refunds for AI agents that pay over **x402 on Hedera**.

An agent pays first. When the service then errors, times out, or returns an empty or malformed body, x402 has no refund step and the money is gone. This gateway sits between the agent and any x402 merchant, checks every response with objective tests, and refunds the agent from the **merchant's bond** when a check fails. Every result is a receipt on **HCS**, merchant reputation is public on **Arkiv**, and merchants prove they are one unique human with **World ID**.

It is a guarantee, not insurance. It cannot judge whether valid-looking data is useful. In this version the bond vault is a custodial Hedera account.

## How a protected call works

```
Agent ── x402 (price + 2% fee, upfront) ──▶ Gateway ── x402 (price) ──▶ Merchant endpoint
                                               │
                                               ├─ objective checks: status, timeout, empty body, JSON, merchant schema
                                               │
                              pass ◀───────────┴───────────▶ fail
                               │                               │
               data → agent, HCS receipt          refund agent from bond, slash bond,
                                                  HCS receipt, Arkiv reputation update
```

| Case | Merchant paid? | Agent refund | From | Bond slash |
|---|---|---|---|---|
| Delivered | yes | none | — | none |
| **A** failed after being paid | yes | price | vault | price + 20% penalty |
| **B** failed and was never paid | no | price | gateway | none |
| **C** our fault | either | price + fee | gateway | none |

Spending controls before any money moves: per-call cap, daily cap, merchant allowlist, minimum merchant score, bond coverage, and owner approval above a threshold.

## Stack

| Layer | Tech |
|---|---|
| Payments | x402 `exact` scheme on Hedera testnet, USDC `0.0.429274`, facilitator Blocky402 (or x402.org / Launa) |
| Refunds, HCS | `@hiero-ledger/sdk` |
| Reputation | Arkiv (Rabdi testnet) `@arkiv-network/sdk` |
| Identity | World ID IDKit 4 (Agent Pass flow); dev login when World is not configured |
| Gateway | Hono + Drizzle/SQLite, background worker for refunds, HCS and Arkiv jobs |
| Web | Next.js 16, Tailwind 4, TanStack Query |

```
apps/gateway         main API, port 4000     apps/demo-merchants  8 real x402 sellers, port 4100
apps/demo-agent      paying agent, port 4200 apps/web             Next.js, port 3000
packages/shared      types, money helpers    scripts/             setup, seed, smoke test, mock facilitator
```

## Setup

Requirements: Node 24 (see `.nvmrc`), npm.

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

1. **One Hedera testnet account** from https://portal.hedera.com (it comes with 1000 HBAR). Put its id and DER key in `GATEWAY_ACCOUNT_ID` / `GATEWAY_PRIVATE_KEY`. `npm run setup` creates the vault, agent and merchant accounts from it and prints their lines for `.env`. Gateway needs USDC (it pays merchants) and the agent needs USDC; the vault gets USDC when `seed` funds bonds from the gateway.
2. **USDC**: https://faucet.circle.com (Hedera testnet) or any testnet USDC holder.
3. Optional **Arkiv**: tGLM at https://hub.arkiv.network/faucet, access key at https://hub.arkiv.network/access-keys. Set `ARKIV_PRIVATE_KEY` (0x EVM key) and `ARKIV_WRITER_ADDRESS`.
4. Optional **World ID**: create an app at https://developer.world.org with staging actions `merchant-register-v1` and `owner-login-v1`. Set `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY`, `NEXT_PUBLIC_WORLD_APP_ID`. Without these, `DEMO_MODE=true` enables a development login.

Then:

```bash
npm run setup                  # associates USDC with every account, creates the HCS topic -> paste HCS_TOPIC_ID into .env
npm run dev -w apps/demo-merchants   # in one terminal (seed and smoke need it)
npm run smoke                  # real on-chain checks: payment, upfront+500, 3-party refund, HCS
SEED_FUND_FROM_GATEWAY=true npm run seed   # demo owner, agent, 8 merchants; funds bonds from gateway -> vault with memo bond:<id>
                               # paste the printed DEMO_AGENT_KEY into .env
npm run dev                    # gateway + merchants + agent + web
```

Open http://localhost:3000/demo.

### Run without funded accounts

`npm run dev:e2e` starts everything against a local mock facilitator with throwaway keys in `.env.e2e` (create it from `.env.example`, any keys, `FACILITATOR_URL=http://localhost:4500`). Payments are signed for real but never settle on-chain, and refunds fail with `INVALID_SIGNATURE` as expected. Useful for UI work only.

## Payment flow in detail

1. `POST /v1/call/:slug` with `x-agent-key`. Policy middleware runs the eight checks; a failure returns 401/403/202 and no money moves.
2. The x402 middleware answers `402` with `amount = price + fee`, `payTo = gateway`, `extra.paymentFlow = "upfront"`. The agent signs a Hedera `TransferTransaction`; the facilitator settles it and pays the network fee.
3. The handler locks `price + penalty` of the merchant's bond, then pays the merchant over x402 from the gateway account and calls the endpoint with the merchant's timeout.
4. Objective checks run. Pass: body returned to the agent. Fail: the payment becomes `refund_pending` with its fault case. On a timeout the gateway asks the mirror node whether its USDC reached the merchant to decide between case A and B.
5. The worker submits the refund (`TransferTransaction` with a fixed transaction id so a retry can never pay twice), slashes the bond ledger, publishes the HCS receipt, and batches a reputation update to Arkiv.

Settled Hedera transactions of real paid requests: agent → gateway settlement [`0.0.7162784-1793909332-800301584`](https://hashscan.io/testnet/transaction/0.0.7162784-1793909332-800301584), three-party refund with bond slash [`0.0.6825454-1793909547-261933222`](https://hashscan.io/testnet/transaction/0.0.6825454-1793909547-261933222), receipts on HCS topic [`0.0.11329161`](https://hashscan.io/testnet/topic/0.0.11329161).

## Use it from Claude, ChatGPT or Cursor (MCP)

`packages/mcp` is an MCP server with four tools: `ask` (pay the best bonded merchant for what the user wants), `list_merchants`, `wallet`, `get_receipt`. It talks to the gateway with an agent's API key, so the assistant can spend only inside the limits the owner set in the web app, and refunds work exactly as in the console. The agent page shows a ready-made config; it looks like:

```json
{ "mcpServers": { "chowkidaar": { "command": "npx", "args": ["-y", "tsx", "<repo>/packages/mcp/src/index.ts"],
  "env": { "CHOWKIDAAR_URL": "http://localhost:4000", "CHOWKIDAAR_AGENT_KEY": "apk_..." } } } }
```

Try it without a host: `CHOWKIDAAR_AGENT_KEY=apk_... node packages/mcp/smoke.mjs "get me a burger"`.

## Use it from Telegram

`packages/telegram` is a bot with the same four operations. Create a bot with @BotFather, put its token in `.env` as `TELEGRAM_BOT_TOKEN`, run `npm run telegram`. Each Telegram user links their own agent once (`/link apk_...`, the message is deleted afterwards) and then just types what they want: "get me a burger", "book me a cab". Deliveries come back with the HashScan transaction, failures with the refund from the merchant's bond, and held payments with the approval link, since only the verified owner can raise the limit.

## API

Full reference, with request/response shapes, error codes and a client example: **[docs/API.md](docs/API.md)**.

In short — Agent: `POST /v1/call/:slug` (x402), `GET /v1/merchants/:slug`, `GET /v1/payments/:id`.
Owner: `/api/agents`, `/api/agents/:id/{allowlist,fund,play,ask}`, `/api/approvals`. Merchant: `/api/merchants`, `/api/merchants/:id/{test,bond,bond/deposits,bond/withdraw}`.
Public: `/api/public/{config,stats,merchants,reputation,receipts}`. All paths are relative to the gateway origin; `GET /api/public/config` returns the environment (network, token, vault, HCS topic, fee, penalty).

## Tests

```bash
npm test          # vitest: money rules, objective checks, policy, mock-facilitator app flow (33 tests)
npm run typecheck
npm run build     # next build
```

## Limits, stated openly

1. Custodial vault: the operator could misuse bonds. A smart-contract vault is the next step.
2. The gateway is the only witness: receipts prove what it recorded, not what the merchant sent.
3. Objective checks only: valid-looking but wrong data passes (see the "wrong-value" demo).
4. Bonds are finite: an uncovered merchant is blocked, not insured.
5. Agents can bypass the gateway; protection covers only routed calls.
6. Testnet only, no audit. World ID proofs at this event use mocked identities.

## Hackathon tracks

- **Hedera, AI Agents That Pay**: x402 endpoints settled on Hedera testnet, autonomous agent, spending controls, HCS audit log, USDC settlement.
- **Arkiv**: merchant reputation entities, see `arkiv/`.
- **World ID**: merchant and owner identity, one human one merchant; debrief in `arkiv/../WORLD.md`.

AI assistance: this codebase was written with the help of an AI coding assistant.
