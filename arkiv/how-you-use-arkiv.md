# How we use Arkiv

**Do the things we filter on fit the app?**
Agents look up one merchant by `merchantId` (indexed) and, in the directory, could sort or filter by `score` (indexed). Those are the only two questions the product asks of the data.

**Who can edit each entity?**
Only the gateway writer wallet. Readers pass `.ownedBy(writer)` so a spoofed entity under the same schema name is ignored.

**When does it expire?**
180 days from creation. Active merchants are patched regularly; abandoned ones disappear.

**Does each Arkiv feature change something users see?**

| Feature | What the user sees |
|---|---|
| `createEntity` on first scored call | Merchant appears with an "Entity" link in the directory and on receipts |
| `patchEntity` after each batch | Score and call counts on the demo console and directory update |
| `.where(eq("merchantId"))` | The demo agent's first timeline step, "Checked merchant reputation on Arkiv", shows the live score before it pays |
| `.ownedBy(writer)` | Protects that step from spoofed entities |
| Expiration | Stale merchants drop out of the agent's choices |

Code: `apps/gateway/src/chain/arkiv.ts`, `apps/gateway/src/worker.ts` (`runArkiv`, batching in `enqueue`), `apps/demo-agent/src/index.ts` (`readArkiv`).
