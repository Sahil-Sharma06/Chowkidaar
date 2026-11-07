# Arkiv feedback

Notes from building the reputation layer on Rabdi with `@arkiv-network/sdk` 1.0.1. Mostly small stuff, a couple of things that actually cost us time.

## SDK / docs

- Numbers need wrappers. `u64(10n)` and `dec("98.50")` work, a bare `10n` throws `SchemaMismatchError`. Fine once you know, but the error doesn't tell you which field broke, so we were guessing for a bit.
- There's no `updateEntity`. You use `patchEntity` with `{ set }`. Took a docs search to find. A tiny create / read / update example on one page would have saved that.
- Expiration is required on create. Makes sense, but the error when you forget it isn't obvious.
- Anyone can write entities under any schema name, so every read has to use `.ownedBy(writer)` or someone can post a fake perfect score for one of our merchants. We do this everywhere now but it's easy to miss. An owner-only option on the schema would fix this for everyone. If we had to pick one thing for you to build, it's this.

## Running it

- The public RPC rate limits pretty quickly. Our agent reads reputation before every payment, so for the demo we basically needed an access key.
- Reads sometimes hang. Once the gateway sat for ~40 seconds waiting on a reputation read with no error and no timeout. We expected either data or an error. We now cache reads for 5–10s and fall back to our own SQLite counts, so payments never wait on Arkiv. A default timeout in the SDK would help.
  To reproduce: run the gateway against Rabdi and hit `/api/public/reputation` in a loop while the RPC is slow.
- Old entities stick around. We reset our local DB at one point, merchants got new ids, and the entities under the old ids are still on Arkiv until the 180 days run out. So anyone listing our entities sees merchants that don't exist anymore. Our agent is fine since it only looks up merchants the gateway knows, but a way to bulk-expire our own entities would be nice.
- A patch doesn't show up in reads right away. Our merchants page says "Publishing to Arkiv…" until Arkiv's `totalCalls` matches ours, then shows the "Verify on Arkiv" link. Knowing the expected delay up front would have helped.

## Time to first write

Quick. Arkiv writes were in our first commit (00:50, 6 Nov) and worked that night. Reads took longer: the owner filter and the number wrappers above meant reputation didn't read back correctly until about 04:30.
