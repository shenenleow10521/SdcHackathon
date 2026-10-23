import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 90000,
    hookTimeout: 60000,
    env: { NODE_ENV: "test", DEMO_MODE: "false" },
  },
});
