# Arkiv feedback

To be completed by the team after running the integration against Rabdi. Prompts:

- What got in the way, or what is missing that would have made building easier?
- When something broke: what did we expect, what happened, how can it be reproduced?

Observed so far while building (from the SDK 1.0.1 surface and docs):

1. Numeric values require wrappers (`u64(10n)`, `dec("98.50")`); a bare `10n` fails with `SchemaMismatchError`. The error does not say which field.
2. There is no `updateEntity`; `patchEntity` with `{ set }` is the way, which took a docs search to find.
3. Expiration is mandatory on create. A sensible default, or a clearer error, would help first-timers.
4. The public RPC is rate limited enough that an access key is effectively required for a demo.
5. Anyone can write entities under our schema name, so every read must filter by owner. A schema-level "owner-only" flag would remove a whole class of spoofing bugs.

**TODO**: time to first successful write, and anything else hit on Rabdi.
