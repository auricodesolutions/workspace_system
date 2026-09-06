import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: { baseURL: process.env.E2E_WEB_URL ?? "http://localhost:3000", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
  webServer: [
    { command: "npm run dev:api", url: "http://127.0.0.1:4000/api/v1/health", reuseExistingServer: true, timeout: 120_000 },
    { command: "npm run dev:web", url: "http://127.0.0.1:3000/login", reuseExistingServer: true, timeout: 120_000 },
  ],
});
