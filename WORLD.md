# World ID integration

We use World ID in two places.

1. **Agent Pass** (OIDC at auth.world.org) for owners. It's how you sign in, and it's also how you approve an agent payment that's over your limit. Approvals force a fresh check, so an agent (or someone on your laptop) can't approve a payment with an old session.
2. **IDKit 4** for merchants, with the action `merchant-register-v1`. One human gets one merchant. If a merchant gets suspended or loses its bond, it can't just sign up again under a new name.

## How it works

Sign-in / approval:
- The web app sends you to `/api/world/oidc/start`. The gateway saves a state, nonce and PKCE verifier (single use, 10 min) and redirects to World.
- World sends you back to `/api/world/oidc/callback`. The gateway swaps the code for an ID token and checks it against World's keys: issuer, audience, nonce, verification level, and auth time.
- For sign-in we set an HttpOnly session cookie. For an approval we mark the approval as approved and the payment goes through.
- Approvals ask for an essential `acr` claim with `max_age=0`, and we reject the token if `auth_time` is from before the request or if it's a different person than the owner.

Merchant check:
- The web app gets a signed `rp_context` from `/api/world/rp-context` (fresh every time since it expires).
- The IDKit widget runs the proof (simulator on staging).
- The result goes to `/api/world/verify`. The gateway verifies it with `developer.world.org/api/v4/verify/{rp_id}`, makes sure the action is `merchant-register-v1`, and saves the nullifier. The DB has `UNIQUE (world_nullifier, world_action)`, so a second merchant from the same person gets a 409.

We never trust what the browser sends back. Only the gateway's own check counts. If anything fails (cancelled, expired, wrong person, World down, etc.) no account or session gets created, and the user sees a plain message about what went wrong.

## Integration debrief

**Time to first success.** Around an hour and a quarter. The repo was set up at 00:50 on 6 Nov and Agent Pass sign-in with approvals was committed at 02:03. Selfie Check sign-in and fixing the approval flow to match the docs took a bit more later that day. (TODO: confirm when the first real sign-in worked.)

**What slowed us down.**
- The redirect URI has to be HTTPS and match exactly, so local dev meant running ngrok. Every time the tunnel dropped (ERR_NGROK_3200) or the URL changed, we had to update `.env`, the World portal and the Next config. This was the biggest time sink.
- `acr_values` vs the `acr` claim. For sign-in, the first value in `acr_values` decides the flow, so listing Orb first locks out Selfie Check users. For approvals, `acr_values` is only a hint and an existing session could slip through, so we switched to an essential claim plus `max_age=0`. Took us two tries.
- The portal's "Default accepted accounts" setting has to match the levels you accept in code. If they don't match it looks like your code is broken.
- Small IDKit things: the widget wants `rp_context` in snake_case but `signRequest` gives you camelCase, and the verify response can have `nullifier` or `nullifier_hash`.
- Action names can never change. A new name means new nullifiers, which means banned merchants could register again. Nothing in the portal warns you about that.

**What's missing.** A full example of step-up auth for approving one action (essential acr, max_age=0, checking auth_time). The pieces are in the docs but spread out. Also a clearer error when you ask for a verification level the portal doesn't allow.

**If we could change one thing.** Allow `http://localhost` redirect URIs on staging. Without the tunnel, getting sign-in working would have taken minutes.

Code: `apps/gateway/src/chain/agentpass.ts`, `apps/gateway/src/chain/world.ts`, `apps/gateway/src/routes/auth.ts`, `apps/web/app/login/page.tsx`, `apps/web/components/MerchantVerify.tsx`.
