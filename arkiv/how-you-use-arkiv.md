# How we use Arkiv

Each merchant has one reputation entity on Arkiv. It holds the merchant id, slug, total calls and failed calls. Right now our wallet owns 21 of them. Two to look at: [SkyCast](https://rabdi.explorer.arkiv.network/entity/0xc490d17c5f6e464398b3318c422846e295d7dd3558be118bc2252fe0168df3b2) (weather, 3 calls, 1 failed) and [BurgerBot](https://rabdi.explorer.arkiv.network/entity/0xa838ddbc6793da53c507021721d55fa6e60454b7d535a67b3157fed27d8127ff) (11 calls, 0 failed).

## What we filter on

Two things. The agent looks up a single merchant by `merchantId` (indexed), and the merchants page lists everything our writer wallet owns. That's all the app ever asks.

## Who can edit

Only our gateway's wallet, [`0x34CBC166F6680753Dc8E3E72e8dB4E04889Da298`](https://rabdi.explorer.arkiv.network/address/0x34CBC166F6680753Dc8E3E72e8dB4E04889Da298). Every read uses `.ownedBy(...)` with that address, so look-alike entities from anyone else are ignored.

## Expiry

180 days. Merchants that keep getting calls keep getting patched. One that nobody uses just disappears, which is what we want.

## How the agent picks a merchant

When an agent asks for something ("book me a cab"), the gateway finds bonded merchants that can do it and ranks them using the call counts from Arkiv (cached 10s; if Arkiv is down we use our own counts).

rank = round(100 × (good + 4) / (total + 5))

So every merchant starts as if it had 4 good calls out of 5. A new merchant isn't buried and isn't treated like a proven one either, and one lucky call doesn't make it 100. Also, about 15% of the time the agent tries a bonded newcomer instead of the top merchant. If the newcomer fails, the bond pays the refund, so the agent loses nothing.

After each call the new counts go to Arkiv within a couple of seconds, so the next agent sees them.

## What users actually see from each feature

- `createEntity`: the merchant gets a "Verify on Arkiv" link on `/merchants`.
- `patchEntity`: counts on `/merchants` update live. Until Arkiv catches up it shows "Publishing to Arkiv…".
- `.where(eq("merchantId", ...))`: the agent checks a merchant's record before paying.
- Reading all our entities: decides which merchant the agent picks.
- `.ownedBy(writer)`: keeps fake entities out of all of the above.
- Expiration: dead merchants drop out on their own.

Code is in `apps/gateway/src/chain/arkiv.ts`, `apps/gateway/src/worker.ts`, `apps/gateway/src/ask.ts`, `apps/gateway/src/money.ts` and `apps/web/app/merchants/page.tsx`.
