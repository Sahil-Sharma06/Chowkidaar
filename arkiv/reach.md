# Reach

**Who is it for, and would they use it?**
Agent builders who want their agents to pay for APIs without a human watching every call, and API sellers who want to be trusted by agents they have never met. The reputation entity is what lets a new agent pick a merchant without talking to us.

**Can they try it today?**
Yes: the demo console at `/demo` runs real x402 payments on Hedera testnet against eight live merchants, and the merchant and owner flows are self-service. Public URL: **TODO paste the hosted URL**.

**Will we keep building after the hackathon?**
Next steps, in order: a smart-contract bond vault (removing the custodial trust), merchant-signed receipts, a per-call `verdict` entity on Arkiv so reputation is auditable call by call, and onboarding the first external merchants.

Numbers from this build: **TODO after demo day** (protected calls, refunds, merchants onboarded; `GET /api/public/stats`).
