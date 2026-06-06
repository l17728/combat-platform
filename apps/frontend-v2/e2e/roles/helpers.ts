import { type Page, type APIRequestContext, expect } from "@playwright/test";

export const API = process.env.E2E_API_URL || `http://127.0.0.1:${process.env.E2E_BACKEND_PORT || "4203"}`;

// ---------------------------------------------------------------------------
// Auth helpers — obtain tokens + user objects for each role
// ---------------------------------------------------------------------------

export interface AuthResult {
  token: string;
  username: string;
  role: string;
  userJson: string; // serialized AuthUser for localStorage injection
}

export async function adminLogin(request: APIRequestContext): Promise<AuthResult> {
  const res = await request.post(`${API}/api/auth/login`, {
    data: { username: "admin", password: "admin123" },
  });
  expect(res.ok()).toBeTruthy();
  const { token, user } = await res.json();
  return { token, username: user.username, role: user.role, userJson: JSON.stringify(user) };
}

export async function registerNormalUser(request: APIRequestContext): Promise<AuthResult> {
  const ts = Date.now();
  const username = `normal_e2e_${ts}`;
  const res = await request.post(`${API}/api/auth/register`, {
    data: { username, password: "test123456" },
  });
  expect(res.ok()).toBeTruthy();
  const { token, user } = await res.json();
  return { token, username: user.username, role: user.role, userJson: JSON.stringify(user) };
}

export async function guestAccess(request: APIRequestContext): Promise<AuthResult> {
  const res = await request.post(`${API}/api/platform/guest-access`);
  expect(res.ok()).toBeTruthy();
  const { token } = await res.json();
  // guest endpoint doesn't return full user; fetch via /auth/me
  const me = await request.get(`${API}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(me.ok()).toBeTruthy();
  const { user } = await me.json();
  return { token, username: user.username, role: user.role, userJson: JSON.stringify(user) };
}

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

export async function dismissTour(page: Page) {
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const hide = (el: Element) => {
      const s = (el as HTMLElement).style;
      s.pointerEvents = "none";
      s.display = "none";
    };
    document.querySelectorAll(".ant-tour").forEach(hide);
    document.querySelectorAll(".ant-modal-wrap").forEach((modal) => {
      const text = modal.textContent || "";
      if (text.includes("修改密码") || text.includes("ForcePasswordChange") || text.includes("passwordMustChange")) {
        hide(modal);
      }
    });
    document.querySelectorAll("svg").forEach((svg) => {
      if (svg.querySelector("rect[fill*='rgba']")) hide(svg);
    });
    document.querySelectorAll("div").forEach((div) => {
      if (div.querySelector(":scope > svg > rect[fill*='rgba']")) hide(div);
    });
  });
  await page.waitForTimeout(300);
}

export async function goTo(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await dismissTour(page);
}

/**
 * Inject full auth state into the SPA's localStorage BEFORE any page scripts run.
 * Uses addInitScript to ensure localStorage is set before React hydrates,
 * preventing AuthGuard from redirecting to /login.
 *
 * Frontend auth guard reads THREE keys: combat-token, combat-role, combat-user (JSON).
 */
export async function injectAuth(page: Page, auth: AuthResult) {
  await page.addInitScript(
    (authData) => {
      localStorage.setItem("combat-token", authData.token);
      localStorage.setItem("combat-role", authData.role);
      localStorage.setItem("combat-user", authData.userJson);
    },
    { token: auth.token, role: auth.role, userJson: auth.userJson }
  );
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

export async function waitForTable(page: Page) {
  try {
    await page.locator(".ant-table").first().waitFor({ state: "visible", timeout: 15000 });
  } catch {
    // Some pages (daily-report, help, bug-report, search) use cards/lists instead of ant-table
    await page
      .locator(".ant-card, .ant-list, .ant-empty, main, [class*='page']")
      .first()
      .waitFor({ state: "visible", timeout: 5000 });
  }
}

export async function waitForDrawer(page: Page) {
  await page.locator(".ant-drawer").waitFor({ state: "visible" });
  await page.waitForTimeout(500);
}

export async function selectOption(page: Page, selectLocator: any, filter: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await selectLocator.locator(".ant-select-selector").click();
      const dropdown = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").last();
      await dropdown.waitFor({ state: "visible", timeout: 5000 });
      await dropdown.locator(".ant-select-item-option").first().waitFor({ state: "attached", timeout: 5000 });
      const opt = dropdown.locator(".ant-select-item-option").filter({ hasText: filter }).first();
      await opt.waitFor({ state: "attached", timeout: 5000 });
      await opt.scrollIntoViewIfNeeded();
      await opt.dispatchEvent("click");
      return;
    } catch {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(400);
    }
  }
}

export function opsCell(row: any) {
  return row.locator("td").last();
}

// ---------------------------------------------------------------------------
// Business CRUD helpers — create test data via API
// ---------------------------------------------------------------------------

export async function createTicket(request: APIRequestContext, token: string, title: string) {
  const res = await request.post(`${API}/api/nodes/attackTicket`, {
    data: { 标题: title, 状态: "待响应" },
    headers: { Authorization: `Bearer ${token}` },
  });
  return res;
}

export async function deleteTicket(request: APIRequestContext, token: string, id: string) {
  await request.delete(`${API}/api/nodes/attackTicket/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}
