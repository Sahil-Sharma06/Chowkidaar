import { describe, expect, it } from "vitest";
import { agentUaid, base58 } from "../src/hcs14.ts";

describe("hcs-14", () => {
  it("base58 matches the bitcoin alphabet", () => expect(base58(Buffer.from("hello"))).toBe("Cn8eVZg"));
  it("is deterministic and carries the parameters in spec order", () => {
    const a = { id: "agt_1", name: " Demo agent ", account: "0.0.123456", network: "hedera:testnet" };
    const u = agentUaid(a);
    expect(u).toBe(agentUaid({ ...a, name: "Demo agent" }));
    expect(u).toMatch(/^uaid:aid:[1-9A-HJ-NP-Za-km-z]{60,70};uid=agt_1;registry=chowkidaar;proto=x402;nativeId=hedera:testnet:0\.0\.123456$/);
  });
  it("changes when the account changes", () => {
    const a = { id: "agt_1", name: "x", account: "0.0.1", network: "hedera:testnet" };
    expect(agentUaid(a)).not.toBe(agentUaid({ ...a, account: "0.0.2" }));
  });
});
