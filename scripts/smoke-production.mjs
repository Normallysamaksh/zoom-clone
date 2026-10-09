import { chromium, expect } from "@playwright/test";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const health = await page.request.get("http://127.0.0.1:3000/api/v1/health");
expect(health.status()).toBe(200);
expect((await health.json()).status).toBe("ok");
await page.goto("http://127.0.0.1:3000");
await expect(
  page.getByText("Product design sync", { exact: true }),
).toBeVisible();
await page.screenshot({
  path: "output/screenshots/production-dashboard.png",
  fullPage: true,
});
await page.getByRole("button", { name: "Meetings", exact: true }).click();
await expect(
  page.getByRole("button", { name: "Weekly team standup", exact: true }),
).toBeVisible();
await page.goto("http://127.0.0.1:3000/j/83245678901");
await expect(
  page.getByRole("heading", { name: "Ready to join?" }),
).toBeVisible();
expect(errors).toEqual([]);
await browser.close();
console.log(
  "Production smoke passed: API health, dashboard, meeting list, and invitation route.",
);
