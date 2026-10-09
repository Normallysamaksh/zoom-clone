import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

await mkdir("output/screenshots", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1024 },
  timezoneId: "Asia/Kolkata",
  reducedMotion: "reduce",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const manifest = [];
async function shot(name, title, description) {
  await page.screenshot({
    path: `output/screenshots/${name}.png`,
    fullPage: true,
  });
  manifest.push({ file: `${name}.png`, title, description });
}
await page.goto("http://127.0.0.1:3000");
await expect(
  page.getByRole("heading", { name: /Good (morning|afternoon|evening), Alex/ }),
).toBeVisible();
await expect(
  page.getByText("Product design sync", { exact: true }),
).toBeVisible();
await shot(
  "01-dashboard",
  "Home dashboard",
  "Desktop home with quick meeting actions, upcoming meetings, recent meetings, and navigation.",
);
await page
  .getByRole("button", { name: "Join Connect with a meeting ID", exact: true })
  .click();
await shot(
  "02-join",
  "Join a meeting",
  "Meeting ID or invitation link, display name, and audio/video preferences.",
);
await page
  .getByRole("textbox", { name: "Meeting ID or invitation link" })
  .fill("99999999999");
await page
  .getByRole("dialog")
  .getByRole("button", { name: "Join", exact: true })
  .click();
await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
  "Meeting not found",
);
await shot(
  "03-join-validation",
  "Join validation",
  "A clear error for an invalid meeting ID.",
);
await page.getByRole("button", { name: "Close dialog" }).click();
await page
  .getByRole("button", { name: "Schedule Make time to connect", exact: true })
  .click();
await page
  .getByRole("textbox", { name: "Topic", exact: true })
  .fill("Sprint planning");
await page
  .getByRole("textbox", { name: /Description/ })
  .fill("Align on priorities, review the backlog, and plan our next sprint.");
await shot(
  "04-schedule",
  "Schedule a meeting",
  "Topic, description, local date and time, duration, and automatic meeting ID.",
);
await page.getByRole("button", { name: "Save", exact: true }).click();
await expect(page.getByText("You’re all set!", { exact: true })).toBeVisible();
await shot(
  "05-scheduled",
  "Schedule confirmation",
  "A saved meeting and its shareable invitation link.",
);
await page.getByRole("button", { name: "Done", exact: true }).click();
await page.getByRole("button", { name: "Meetings", exact: true }).click();
await shot(
  "06-meetings",
  "Upcoming meetings",
  "Searchable meeting list with dates, IDs, and start or join actions.",
);
await page.getByRole("button", { name: /Previous/ }).click();
await shot(
  "07-history",
  "Meeting history",
  "Completed meetings retained in the recent meeting history.",
);
await page.getByRole("button", { name: "Upcoming", exact: false }).click();
await page
  .getByRole("button", { name: "Sprint planning", exact: true })
  .click();
await shot(
  "08-details",
  "Meeting details",
  "Host, schedule, meeting ID, invitation link, and host actions.",
);
await page.getByRole("button", { name: "Close dialog" }).click();
await page.getByRole("button", { name: "Settings", exact: true }).click();
await shot(
  "09-settings",
  "Settings",
  "Default user profile and preferences saved on this device.",
);
await page.getByRole("button", { name: "Profile menu" }).click();
await shot(
  "10-profile",
  "Profile",
  "Default user, availability, and workspace plan.",
);
await page.getByRole("button", { name: "Close dialog" }).click();
await page.getByRole("button", { name: "Notifications", exact: true }).click();
await shot(
  "10a-notifications",
  "Notifications",
  "An empty notification state with a clear close action.",
);
await page.getByRole("button", { name: "Close dialog" }).click();
await page.getByRole("button", { name: "Help", exact: true }).click();
await shot(
  "10b-help",
  "Help",
  "A short guide to starting, joining, and scheduling meetings.",
);
await page.getByRole("button", { name: "Close dialog" }).click();
await page.getByRole("button", { name: "Home", exact: true }).click();
await page.getByRole("button", { name: "New meeting", exact: false }).click();
await expect(
  page.getByRole("heading", { name: "Ready to join?" }),
).toBeVisible();
await shot(
  "11-prejoin",
  "Pre-join preview",
  "Camera preview, microphone and camera controls, host information, and display name.",
);
await page.getByRole("button", { name: "Join meeting", exact: true }).click();
await expect(page.locator(".stage-title")).toContainText("You’re connected");
await shot(
  "12-room",
  "Meeting room",
  "Dark meeting room with video tile, invitation action, timer, and the meeting toolbar.",
);
await page.getByRole("button", { name: "Participants", exact: false }).click();
await shot(
  "13-participants",
  "Participants panel",
  "Participant presence, host badge, invitation action, and host mute controls.",
);
await page.getByRole("button", { name: "Chat", exact: true }).click();
await page
  .getByRole("textbox", { name: "Message everyone" })
  .fill("Welcome! Let’s get started.");
await page.getByRole("button", { name: "Send message" }).click();
await expect(
  page.getByText("Welcome! Let’s get started.", { exact: true }),
).toBeVisible();
await shot(
  "14-chat",
  "Meeting chat",
  "Everyone-in-meeting chat with message composer and timestamps.",
);
await page.getByRole("button", { name: "Meeting information" }).click();
await shot(
  "15-invitation",
  "Meeting invitation",
  "Copyable invitation link and meeting ID from inside the room.",
);
await page.getByRole("button", { name: "Close dialog" }).click();
await page.getByRole("button", { name: "End", exact: true }).click();
await shot(
  "16-end",
  "End or leave",
  "Host choice to leave the room or end the meeting for everyone.",
);
await page.getByRole("button", { name: "Cancel", exact: true }).click();
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("button", { name: "Close panel" }).click();
await shot(
  "17-mobile-room",
  "Mobile meeting room",
  "Portrait video layout with compact meeting controls.",
);
await page.goto("http://127.0.0.1:3000");
await expect(
  page.getByText("Product design sync", { exact: true }),
).toBeVisible();
await shot(
  "18-mobile-home",
  "Mobile dashboard",
  "Responsive meeting actions, meeting cards, and bottom navigation.",
);
await page
  .getByRole("button", { name: "Schedule Make time to connect", exact: true })
  .click();
await shot(
  "19-mobile-schedule",
  "Mobile scheduling",
  "A single-column scheduling form sized for smaller screens.",
);
await page.getByRole("button", { name: "Close dialog" }).click();
await page.getByRole("button", { name: "Meetings", exact: true }).click();
await shot(
  "20-mobile-meetings",
  "Mobile meetings",
  "Meeting list and search on a narrow viewport.",
);
await page.getByRole("button", { name: "Settings", exact: true }).click();
await shot(
  "20a-mobile-settings",
  "Mobile settings",
  "Profile and audio/video preferences on mobile.",
);
await page.goto("http://127.0.0.1:3000/j/83245678901");
await expect(
  page.getByRole("heading", { name: "Ready to join?" }),
).toBeVisible();
await shot(
  "20b-mobile-prejoin",
  "Mobile pre-join",
  "Portrait camera preview and meeting information before joining.",
);
await page.goto("http://127.0.0.1:3000/j/99999999999");
await expect(
  page.getByRole("heading", { name: "Unable to join meeting" }),
).toBeVisible();
await page.setViewportSize({ width: 1440, height: 1024 });
await shot(
  "21-unavailable",
  "Meeting unavailable",
  "Friendly error page with a path back to the dashboard.",
);
if (errors.length) throw new Error(`Browser errors: ${errors.join("\n")}`);
await writeFile(
  "output/screenshots/manifest.json",
  JSON.stringify(manifest, null, 2),
);
console.log(
  `Frontend checks passed. Captured ${manifest.length} screens. No browser errors.`,
);
await browser.close();
