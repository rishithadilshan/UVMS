require("dotenv").config({ path: ".env.qa" });
const { defineConfig, devices } = require("@playwright/test");
const frontendURL = process.env.FRONTEND_URL || "http://127.0.0.1:5174";
const apiURL = process.env.API_URL || "http://127.0.0.1:5050/api";
function assertLocal(value, name) {
  const host = new URL(value).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host))
    throw new Error(`${name} must use localhost. Remote/production test targets are blocked: ${host}`);
}
assertLocal(frontendURL, "FRONTEND_URL");
assertLocal(apiURL, "API_URL");
module.exports = defineConfig({
  testDir: "./tests", fullyParallel: false, workers: 1,
  forbidOnly: !!process.env.CI, retries: process.env.CI ? 1 : 0,
  timeout: 45000, expect: { timeout: 8000 },
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  outputDir: "test-results",
  use: { baseURL: frontendURL, trace: "retain-on-failure",
    screenshot: "only-on-failure", video: "retain-on-failure",
    actionTimeout: 10000, navigationTimeout: 15000, ...devices["Desktop Chrome"] },
  metadata: { apiURL, frontendURL }
});
