// 现网 release notes 渲染验证 — 起 headless Chromium 登 admin/admin123 → /manual → 点 Release Notes → 抓文本断言关键段。
import { chromium } from 'playwright';

const URL = 'http://124.156.193.122:3001';
const USER = 'admin';
const PASS = 'admin123';

const KEYS = [
  'v1.0.0 — 2026-05-30 (首版完整功能盘点)',
  '本期核心新增',
  '攻关单私密协作',
  '已稳定运行的全部功能',
  '灵活 Excel 导入',
  '后续版本',
];

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  console.log(`[1] goto ${URL}/login`);
  await page.goto(`${URL}/login`, { waitUntil: 'networkidle' });

  console.log('[2] login as admin');
  await page.getByPlaceholder(/用户名|账号|username/i).fill(USER);
  await page.getByPlaceholder(/密码|password/i).fill(PASS);
  await page.getByRole('button', { name: /登 ?录/ }).click();
  await page.waitForURL(/\/$|\/dashboard|^(?!.*\/login)/, { timeout: 10000 });
  console.log(`   → url: ${page.url()}`);

  console.log('[3] goto /manual');
  await page.goto(`${URL}/manual`, { waitUntil: 'networkidle' });

  console.log('[4] click "Release Notes" menu item');
  await page.locator('li.ant-menu-item').filter({ hasText: /Release Notes/i }).first().click();
  await page.waitForTimeout(800);

  console.log('[5] extract main card text');
  const card = await page.locator('.ant-card .markdown-body').first().innerText();

  let ok = 0, miss = [];
  for (const k of KEYS) {
    if (card.includes(k)) { ok++; console.log(`   ✓ ${k}`); }
    else { miss.push(k); console.log(`   ✗ ${k}`); }
  }

  console.log('\n=== summary ===');
  console.log(`prod URL: ${URL}/manual`);
  console.log(`page title shown: ${(await page.locator('.ant-card h5').first().innerText().catch(() => '?'))}`);
  console.log(`assertions ${ok}/${KEYS.length}`);
  if (miss.length) console.log(`missing: ${miss.join(' | ')}`);
  console.log(`card preview (first 400 chars):\n${card.slice(0, 400)}`);

  await browser.close();
  process.exit(miss.length ? 1 : 0);
}

main().catch(e => { console.error('ERROR:', e); process.exit(2); });
