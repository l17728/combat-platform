import { type Page, type Locator } from '@playwright/test';

const API = 'http://localhost:3001';

export { API };

export function opsCell(row: Locator): Locator {
  return row.locator('td').last();
}

export async function selectOption(
  page: Page,
  selectLocator: Locator,
  optionName: string,
  exact = false,
): Promise<void> {
  await selectLocator.scrollIntoViewIfNeeded();
  await selectLocator.locator('.ant-select-selector').click();
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
    .last()
    .waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(200);
  const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
  const opt = exact
    ? dropdown.locator('.ant-select-item-option').filter({ hasText: new RegExp(`^${optionName}$`) }).first()
    : dropdown.locator('.ant-select-item-option').filter({ hasText: optionName }).first();
  await opt.waitFor({ state: 'attached', timeout: 5000 });
  await opt.dispatchEvent('click');
}

export async function selectOptionContaining(
  page: Page,
  selectLocator: Locator,
  text: string,
): Promise<void> {
  await selectLocator.scrollIntoViewIfNeeded();
  await selectLocator.locator('.ant-select-selector').click();
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
    .last()
    .waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(200);
  const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
  const opt = dropdown.locator('.ant-select-item-option').filter({ hasText: text }).first();
  await opt.waitFor({ state: 'attached', timeout: 5000 });
  await opt.dispatchEvent('click');
}

export async function waitForDrawer(page: Page): Promise<void> {
  await page.locator('.ant-drawer').waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
}

export async function waitForTable(page: Page): Promise<void> {
  await page.locator('.ant-table').waitFor({ state: 'visible', timeout: 10000 });
}
