/**
 * 全页面 UI 元素扫描器
 * 访问每一个页面，采集所有可交互元素（button/link/switch/input/select）
 * 输出 JSON 供后续生成 100% 覆盖的 e2e 测试
 */
const BASE = 'http://124.156.193.122:3001';
const fs = require('fs');

async function scan(page, urls, label) {
  const results = {};
  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(2000);
      // Dismiss any modals/popups
      await page.locator('.ant-tour-close, .ant-modal-close, button:has-text("知道了"), button:has-text("跳过")').click().catch(() => {});
      await page.waitForTimeout(500);

      const elements = await page.evaluate(() => {
        const items = [];
        // All buttons
        document.querySelectorAll('button, [role="button"], .ant-btn, .ant-switch, a[href], input, select, textarea, [role="switch"], [role="tab"], .ant-menu-item, .ant-menu-submenu-title, .ant-checkbox, .ant-radio').forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return; // skip hidden
          const tag = el.tagName.toLowerCase();
          const role = el.getAttribute('role') || '';
          const type = el.getAttribute('type') || '';
          const text = (el.textContent || '').trim().slice(0, 80);
          const ariaLabel = el.getAttribute('aria-label') || '';
          const placeholder = el.getAttribute('placeholder') || '';
          const href = el.getAttribute('href') || '';
          const className = el.className || '';
          const id = el.id || '';
          const disabled = el.disabled || el.classList.contains('ant-btn-disabled') || el.getAttribute('aria-disabled') === 'true';

          let category = 'other';
          if (tag === 'button' || type === 'button' || type === 'submit' || role === 'button' || className.includes('ant-btn')) category = 'button';
          else if (tag === 'a' && href) category = 'link';
          else if (tag === 'input' || tag === 'textarea') category = 'input';
          else if (tag === 'select') category = 'select';
          else if (role === 'switch' || className.includes('ant-switch')) category = 'switch';
          else if (role === 'tab' || className.includes('ant-tabs-tab')) category = 'tab';
          else if (className.includes('ant-menu-item') || className.includes('ant-menu-submenu-title')) category = 'menu';
          else if (className.includes('ant-checkbox')) category = 'checkbox';
          else if (className.includes('ant-radio')) category = 'radio';

          items.push({ tag, category, text, ariaLabel, placeholder, href, disabled, id: id.slice(0, 50), classes: className.slice(0, 100) });
        });
        return items;
      });

      // Also capture visible tabs
      const tabs = await page.locator('[role="tab"]').allTextContents().catch(() => []);

      results[url] = {
        title: await page.title(),
        url: page.url(),
        elementCount: elements.length,
        categories: {
          buttons: elements.filter(e => e.category === 'button' && !e.disabled).map(e => e.text || e.ariaLabel || `[${e.id}]`),
          disabledButtons: elements.filter(e => e.category === 'button' && e.disabled).map(e => e.text || e.ariaLabel || `[${e.id}]`),
          links: elements.filter(e => e.category === 'link').map(e => `${e.text}→${e.href}`),
          inputs: elements.filter(e => e.category === 'input').map(e => e.placeholder || e.ariaLabel || `[${e.id}]`),
          selects: elements.filter(e => e.category === 'select').map(e => e.text || e.ariaLabel),
          switches: elements.filter(e => e.category === 'switch').map(e => e.text || e.ariaLabel || `[${e.id}]`),
          tabs: elements.filter(e => e.category === 'tab').map(e => e.text),
          menus: elements.filter(e => e.category === 'menu').map(e => e.text),
        },
        all: elements,
      };
      console.log(`[${label}] ${url}: ${elements.length} elements`);
    } catch (err) {
      results[url] = { error: err.message };
      console.error(`[${label}] ${url}: ERROR - ${err.message}`);
    }
  }
  return results;
}

async function run(page) {
  // ---- Step 1: Login as admin ----
  console.log('\n=== Logging in as admin ===');
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 10000 });
  await page.waitForTimeout(1500);

  // Fill login form
  const inputs = page.locator('input');
  const inputCount = await inputs.count();
  if (inputCount >= 2) {
    await inputs.nth(0).fill('admin');
    await inputs.nth(1).fill('a12345678');
  }
  await page.locator('button[type="submit"], button:has-text("登录")').first().click();
  await page.waitForTimeout(3000);
  console.log('Admin login done, URL:', page.url());

  // Dismiss password change modal if present
  await page.locator('.ant-modal button:has-text("取消"), .ant-modal-close').click().catch(() => {});
  await page.waitForTimeout(500);

  // Dismiss tour if present
  await page.locator('.ant-tour-close, button:has-text("跳过"), button:has-text("知道了")').click().catch(() => {});
  await page.waitForTimeout(500);

  // ---- Step 2: Discover all menu items ----
  console.log('\n=== Discovering all menu items ===');
  // Click system management to expand submenu
  const menuItems = await page.evaluate(() => {
    const items = [];
    document.querySelectorAll('.ant-menu-item, .ant-menu-submenu-title').forEach(el => {
      const text = (el.textContent || '').trim().slice(0, 60);
      if (text) items.push(text);
    });
    return items;
  });
  console.log('Menu items found:', menuItems);

  // Expand all submenus by clicking them
  for (const submenu of ['攻关管理', '人员与荣誉', '求助中心', '工具', '系统管理']) {
    await page.locator(`.ant-menu-submenu-title:has-text("${submenu}")`).click().catch(() => {});
    await page.waitForTimeout(500);
  }

  // Now collect all submenu items
  const allMenuItems = await page.evaluate(() => {
    const items = [];
    document.querySelectorAll('.ant-menu-item').forEach(el => {
      const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      if (text) items.push(text);
    });
    return [...new Set(items)];
  });
  console.log('All submenu items:', allMenuItems);

  // ---- Step 3: Scan all pages as admin ----
  const adminUrls = [
    `${BASE}/`,
    `${BASE}/attack`,
    `${BASE}/attack`,  // main attack page
    `${BASE}/persons`,
    `${BASE}/honor`,
    `${BASE}/help`,
    `${BASE}/import`,
    `${BASE}/schema`,
    `${BASE}/backup`,
    `${BASE}/config`,
    `${BASE}/email`,
    `${BASE}/llm-settings`,
    `${BASE}/digest`,
    `${BASE}/merge`,
    `${BASE}/op-log`,
    `${BASE}/webhooks`,
    `${BASE}/invitations`,
    `${BASE}/audit`,
    `${BASE}/platform`,
    `${BASE}/system-upgrade`,
    `${BASE}/db-migration`,
    `${BASE}/users`,
    `${BASE}/wiki`,
    `${BASE}/documents`,
    `${BASE}/knowledge`,
    `${BASE}/hermes`,
    `${BASE}/notifications`,
    `${BASE}/settings`,
    `${BASE}/tools`,
    `${BASE}/graph`,
    `${BASE}/kg-rebuild`,
  ];

  console.log('\n=== Scanning admin pages ===');
  const adminResults = await scan(page, adminUrls, 'admin');

  // ---- Step 4: Switch to guest mode ----
  console.log('\n=== Switching to guest mode ===');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  const guestResp = await page.request.post(`${BASE}/api/platform/guest-access`);
  const { token } = await guestResp.json();
  await page.evaluate((t) => {
    localStorage.setItem('combat-token', t);
  }, token);
  await page.goto(`${BASE}/attack`, { waitUntil: 'networkidle', timeout: 10000 });
  await page.waitForTimeout(2000);
  console.log('Guest mode, URL:', page.url());

  // ---- Step 5: Scan all pages as guest ----
  console.log('\n=== Scanning guest pages ===');
  const guestResults = await scan(page, adminUrls, 'guest');

  // ---- Step 6: Save results ----
  const output = {
    timestamp: new Date().toISOString(),
    menuItems: allMenuItems,
    admin: adminResults,
    guest: guestResults,
  };
  fs.writeFileSync('/fighting/e2e/ui-scan-results.json', JSON.stringify(output, null, 2));
  console.log('\n=== Results saved to /fighting/e2e/ui-scan-results.json ===');

  // Summary
  let totalAdmin = 0, totalGuest = 0;
  for (const [url, data] of Object.entries(adminResults)) {
    if (data.elementCount) totalAdmin += data.elementCount;
  }
  for (const [url, data] of Object.entries(guestResults)) {
    if (data.elementCount) totalGuest += data.elementCount;
  }
  console.log(`\nSummary: Admin=${totalAdmin} elements, Guest=${totalGuest} elements across ${adminUrls.length} pages`);

  return output;
}

module.exports = run;
