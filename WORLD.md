# World ID integration

## What the proof protects

- **Merchant registration** (`merchant-register-v1`): one human can register one merchant. The gateway enforces `UNIQUE (world_nullifier, world_action)`, so a slashed or suspended merchant cannot come back under a new name. Suspended accounts are rejected at login (`403 suspended`) and never reach the protected action.
- **Owner login** (`owner-login-v1`): identity for the person who sets an agent's spending limits and approves large payments.

## Flow

1. Frontend `GET /api/world/rp-context?role=…`; backend signs the request with the RP signing key (`signRequest` from `@worldcoin/idkit-core/signing`). The context expires, so it is fetched fresh each time.
2. `IDKitRequestWidget` opens with that `rp_context`.
3. User completes the proof (simulator in staging).
4. Frontend `POST /api/world/verify`; backend calls `developer.world.org/api/v4/verify/{rp_id}`, rejects failures, checks that the returned `action` matches the requested role, then finds or creates the account by `(nullifier, action)` and sets an `HttpOnly` session cookie.

Unsuccessful paths: widget closed (nothing happens), verification failed (401, "We couldn't verify you"), action mismatch (401), suspended merchant (403), World API down (401 with detail). In every case no account is created and no session is set.

The client response is never treated as authorization: only the server-side verification result is.

## Integration debrief

**TODO after running against the World portal**: time to first success, friction encountered, missing capability or documentation, and the one improvement with the greatest impact.

Code: `apps/gateway/src/chain/world.ts`, `apps/gateway/src/routes/auth.ts`, `apps/web/components/WorldLogin.tsx`.
