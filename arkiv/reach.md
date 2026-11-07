# Reach

## Who is it for

Two groups. People building agents that pay for APIs and don't want to babysit every payment, and people selling APIs who want agents to trust them even though they've never heard of them. The reputation on Arkiv is what lets an agent pick a merchant without having to take our word for it.

## Can you try it today

Yes, it's live on Hedera testnet with real x402 payments.

- `/merchants` lists every bonded merchant with its reputation and a link to the entity on Arkiv.
- Hook up our MCP server to Claude (or any MCP client) and just ask, e.g. "weather in Delhi" or "book me a cab". It checks reputation, pays, and refunds from the merchant's bond if the call fails.
- Or use the Telegram bot: `/link apk_...` once, then type what you want.
- If you sell an API, you can register, post a bond and start getting paid. Our weather merchant, SkyCast, was about 150 lines.

Public URL: TODO

Numbers so far (testnet, from `GET /api/public/stats`, 7 Nov): 22 protected calls, 12 refunds paid out of merchant bonds, 0.21 USDC refunded, 12 merchants. We'll update these on demo day.

## Will we keep building after Mumbai

Yes. Next up: move the bond into a smart contract so we're not holding merchant funds, have merchants sign their responses, write a verdict entity per call on Arkiv so the score can be checked call by call, lower the penalty for merchants with a long clean record, and get a few outside merchants on.
