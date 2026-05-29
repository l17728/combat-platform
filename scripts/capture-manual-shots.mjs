// Capture user-manual screenshots from a running env into the frontend's public assets.
// usage: node scripts/capture-manual-shots.mjs [api]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://124.156.193.122:3001';
const OUT = fileURLToPath(new URL('../apps/frontend-v2/public/manual-shots/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByRole('textbox', { name: '用户名' }).fill('admin');
  await page.getByRole('textbox', { name: '密码' }).fill('admin123');
  await page.getByRole('button', { name: '登 录' }).click();
  await page.waitForURL(`${BASE}/`);
  await page.waitForTimeout(800);

  const token = await page.evaluate(() => localStorage.getItem('combat-token'));
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const tickets = await (await page.request.get(`${BASE}/api/nodes/attackTicket`, { headers })).json();
  const ticketId = Array.isArray(tickets) && tickets[0] ? tickets[0].id : '';
  const contribs = await (await page.request.get(`${BASE}/api/nodes/contribution`, { headers })).json();
  const personName = Array.isArray(contribs) && contribs[0] ? contribs[0].properties['贡献人'] : '张三';

  const routes = {
    dashboard: '/',
    attackList: '/attack',
    attackDetail: ticketId ? `/attack/${ticketId}` : '/attack',
    dailyReport: '/daily-report',
    peopleList: '/people',
    contributions: '/contributions',
    honor: '/honor',
    personHonor: `/honor/${encodeURIComponent(personName)}`,
    mergePage: '/merge',
    helpCenter: '/help',
    documentCenter: '/documents',
    proposals: '/proposals',
    reminders: '/reminders',
    search: '/search',
    relatedPage: ticketId ? `/related/attackTicket/${ticketId}` : '/attack',
    importExport: '/import',
    schemaWizard: '/schema',
    configCenter: '/config',
    emailSettings: '/email',
    auditLog: '/audit',
    backupRestore: '/backup',
    userManagement: '/users',
    bugReport: '/bug-report',
  };

  let ok = 0;
  for (const [key, route] of Object.entries(routes)) {
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(900);
      await page.screenshot({ path: join(OUT, `${key}.png`) });
      ok++;
      console.log(`  ✓ ${key} (${route})`);
    } catch (e) {
      console.log(`  ✗ ${key}: ${e.message}`);
    }
  }
  console.log(`\n${ok}/${Object.keys(routes).length} screenshots → ${OUT}`);
} finally {
  await b.close();
}
