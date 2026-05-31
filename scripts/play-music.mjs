import { chromium } from "playwright";

const URL = "https://www.youtube.com/watch?v=Qi8o7h2xvXw";

const browser = await chromium.launch({
  headless: false,
  channel: "chrome",
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--start-maximized",
    "--disable-features=BlockInsecurePrivateNetworkRequests",
  ],
});
const ctx = await browser.newContext({
  viewport: null,
  permissions: [],
});
const page = await ctx.newPage();

console.log("opening", URL);
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(4000);

for (const sel of [
  'button:has-text("Accept all")',
  'button:has-text("接受全部")',
  'button[aria-label*="Accept"]',
  'button[aria-label*="接受"]',
]) {
  try {
    await page.locator(sel).first().click({ timeout: 2000 });
    console.log("dismissed consent:", sel);
    break;
  } catch {}
}
await page.waitForTimeout(2000);

for (const sel of [
  ".ytp-large-play-button",
  ".ytp-play-button",
  'button[title*="Play"]',
  'button[title*="播放"]',
  'button[aria-label*="Play"]',
  'button[aria-label*="播放"]',
]) {
  try {
    await page.locator(sel).first().click({ timeout: 3000 });
    console.log("clicked play:", sel);
    break;
  } catch {}
}
await page.keyboard.press("k").catch(() => {});

console.log("playing — browser will stay open. Close the window or Ctrl+C this script to stop.");
await new Promise(() => {});
