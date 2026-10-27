import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  retries: 0,
  timeout: 30_000,
  use: { viewport: { width: 1440, height: 1000 } },
});
