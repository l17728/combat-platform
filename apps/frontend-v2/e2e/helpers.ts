import { type Page, type Locator } from '@playwright/test';

const API = process.env.E2E_API_URL || 'http://localhost:3201';

export { API };

export function opsCell(row: Locator): Locator {
  return row.locator('td').last();
}

async function pickOption(page: Page, selectLocator: Locator, filter: string | RegExp): Promise<void> {
  await selectLocator.scrollIntoViewIfNeeded();
  let lastErr: unknown;
  // AntD renders the dropdown in a body-level portal and the open click
  // occasionally races (dropdown shows but options not yet populated, or the
  // click toggles it shut). Retry the open-and-pick to absorb that flakiness.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await selectLocator.locator('.ant-select-selector').click();
      const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
      await dropdown.waitFor({ state: 'visible', timeout: 4000 });
      await page.waitForTimeout(150);
      const opt = dropdown.locator('.ant-select-item-option').filter({ hasText: filter }).first();
      await opt.waitFor({ state: 'attached', timeout: 4000 });
      await opt.dispatchEvent('click');
      return;
    } catch (e) {
      lastErr = e;
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(300);
    }
  }
  throw lastErr;
}

export async function selectOption(
  page: Page,
  selectLocator: Locator,
  optionName: string,
  exact = false,
): Promise<void> {
  await pickOption(page, selectLocator, exact ? new RegExp(`^${optionName}$`) : optionName);
}

export async function selectOptionContaining(
  page: Page,
  selectLocator: Locator,
  text: string,
): Promise<void> {
  await pickOption(page, selectLocator, text);
}

export async function waitForDrawer(page: Page): Promise<void> {
  await page.locator('.ant-drawer').waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
}

export async function waitForTable(page: Page): Promise<void> {
  await page.locator('.ant-table').first().waitFor({ state: 'visible', timeout: 10000 });
}
