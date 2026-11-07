# Why Arkiv

**If we swapped Arkiv for Postgres, what would users lose?**

The point of the reputation score is that the *agent* reads it before paying, and the agent should not have to trust our API to tell it the truth about our own merchants. With Postgres the score is whatever our server says. With Arkiv:

- The agent (and any other gateway, dashboard, or auditor) reads the entity directly from the chain, filtered by the writer wallet, without calling us. Try it: [our wallet's entities](https://rabdi.explorer.arkiv.network/address/0x34CBC166F6680753Dc8E3E72e8dB4E04889Da298), or [SkyCast's record](https://rabdi.explorer.arkiv.network/entity/0xc490d17c5f6e464398b3318c422846e295d7dd3558be118bc2252fe0168df3b2).
- Ownership is enforced by the network: only the gateway's writer key can patch an entity, and nobody can edit history out from under a reader.
- Expiry is a feature, not a cron job: a merchant that stops being used ages out of the directory on its own.

The gateway still keeps its own SQLite copy of the counters so that an Arkiv outage can never block payments. Arkiv is the public, checkable copy.

**What did we keep off Arkiv, and why?**

- Payments, bonds and refunds: on Hedera, because that is where the money is.
- Receipts: on HCS, because they must be ordered and append-only, and we never want them to expire.
- Response bodies, World ID nullifiers, API keys: never on any chain. Only hashes and ids leave the gateway.
- Per-call verdicts: these are HCS messages, not Arkiv entities. We considered a `verdict` entity per call but a rolling score on one entity per merchant is what the agent actually filters on, and it keeps writes cheap.
