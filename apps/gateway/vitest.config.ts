import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    env: {
      GATEWAY_ACCOUNT_ID: "0.0.1001",
      GATEWAY_PRIVATE_KEY: "302e020100300506032b657004220420aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      VAULT_ACCOUNT_ID: "0.0.1002",
      VAULT_PRIVATE_KEY: "302e020100300506032b657004220420bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      DATABASE_PATH: ":memory:",
      DEMO_MODE: "true",
      FEE_BPS: "200",
      PENALTY_BPS: "2000",
    },
  },
});
