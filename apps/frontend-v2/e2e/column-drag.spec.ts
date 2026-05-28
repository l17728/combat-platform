import { test, expect } from '@playwright/test';

// Regression: useFlexTable column resize + reorder must actually work.
// Bug history: onHeaderCell did not pass `id` (reorder dead) and onResize only
// mutated a ref without setState (resize dead). Both verified broken on prod.

test.describe('表格列拖拽 (useFlexTable)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('combat-col-w-person');
      localStorage.removeItem('combat-col-o-person');
    });
    await page.goto('/people');
    await page.waitForSelector('.ant-table-thead th');
  });

  test('drag resize handle changes column width and persists', async ({ page }) => {
    const th = page.locator('.ant-table-thead th').first();
    const box = await th.boundingBox();
    expect(box).not.toBeNull();
    const before = box!.width;

    // The resize handle is a 6px span pinned to the right edge of the header.
    const handleX = box!.x + box!.width - 3;
    const handleY = box!.y + box!.height / 2;
    await page.mouse.move(handleX, handleY);
    await page.mouse.down();
    await page.mouse.move(handleX + 70, handleY, { steps: 8 });
    await page.mouse.up();

    await expect.poll(async () => {
      const b = await th.boundingBox();
      return b ? Math.round(b.width) : 0;
    }).toBeGreaterThan(Math.round(before) + 30);

    const saved = await page.evaluate(() => localStorage.getItem('combat-col-w-person'));
    expect(saved).not.toBeNull();
  });

  test('drag header reorders columns and persists', async ({ page }) => {
    const order = () => page.locator('.ant-table-thead th').evaluateAll(
      (ths) => ths.map((t) => (t.textContent || '').trim().slice(0, 6)),
    );
    const before = await order();
    expect(before.length).toBeGreaterThanOrEqual(3);

    // dnd-kit PointerSensor needs an activation move (>5px) then intermediate
    // moves before release; Playwright's dragTo() is too abrupt for it.
    const fb = (await page.locator('.ant-table-thead th').nth(0).boundingBox())!;
    const tb = (await page.locator('.ant-table-thead th').nth(2).boundingBox())!;
    const fy = fb.y + fb.height / 2;
    await page.mouse.move(fb.x + fb.width / 2, fy);
    await page.mouse.down();
    await page.mouse.move(fb.x + fb.width / 2 + 12, fy, { steps: 3 });
    await page.mouse.move(tb.x + tb.width / 2, fy, { steps: 12 });
    await page.mouse.move(tb.x + tb.width / 2 + 4, fy, { steps: 2 });
    await page.waitForTimeout(150);
    await page.mouse.up();

    await expect.poll(async () => (await order())[0]).not.toBe(before[0]);

    const saved = await page.evaluate(() => localStorage.getItem('combat-col-o-person'));
    expect(saved).not.toBeNull();
  });
});
