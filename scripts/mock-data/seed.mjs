#!/usr/bin/env node
// mock:seed — 批量创建模拟数据（人员、攻关单、贡献记录）
// 用法: node scripts/mock-data/seed.mjs [--api http://localhost:3001] [--count 20]
// 前提: 后端 API 正在运行

const API = process.env.COMBAT_API || process.argv.includes('--api')
  ? process.argv[process.argv.indexOf('--api') + 1]
  : 'http://localhost:3001';

const getCount = () => {
  const i = process.argv.indexOf('--count');
  return i >= 0 ? parseInt(process.argv[i + 1], 10) : 20;
};

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function del(path) {
  const res = await fetch(`${API}${path}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`DELETE ${path} → ${res.status}: ${text}`);
  }
}

async function list(nodeType) {
  const res = await fetch(`${API}/api/nodes/${nodeType}`);
  if (!res.ok) return [];
  return res.json();
}

const DEPARTMENTS = ['网络部', '平台部', '安全部', '数据部', '运维部', '研发部'];
const NAMES = [
  '张伟', '王芳', '李强', '刘洋', '陈静', '杨磊', '赵敏', '黄浩',
  '周琳', '吴涛', '徐明', '孙丽', '马超', '朱峰', '胡婷',
  '郭鑫', '林鹏', '何雪', '高飞', '罗军',
];
const LEVELS = ['P1', 'P2', 'P3', 'P4', 'P4A', 'P4B'];
const STATUSES = ['待响应', '处理中', '进行中', '已解决', '已关闭'];
const CUSTOMERS = ['华为云', '阿里云', '腾讯云', '中国移动', '中国电信', '国家电网', '工商银行'];
const CONTRIB_TYPES = ['发现', '设计', '实施', '协调', '公关'];
const CONTRIB_LEVELS = ['普通', '关键', '核心'];
const PERIODS = ['2025-Q1', '2025-Q2', '2025-Q3', '2025-Q4', '2026-Q1', '2026-Q2'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

async function seed() {
  const count = getCount();
  console.log(`=== 模拟数据填充 (API: ${API}, 人员数: ${count}) ===\n`);

  // 1. 创建人员
  console.log('1. 创建人员...');
  const people = [];
  for (let i = 0; i < count; i++) {
    const name = NAMES[i % NAMES.length] + (i >= NAMES.length ? randInt(2, 9) : '');
    try {
      const p = await post('/api/nodes/person', {
        姓名: name,
        工号: `EMP${String(randInt(1000, 9999))}`,
        部门: pick(DEPARTMENTS),
        邮箱: `${name}@mock.com`,
        角色: pick(['normal', 'leader', 'admin']),
      });
      people.push(p);
    } catch (e) {
      console.warn(`   人员 ${name} 创建失败: ${e.message}`);
    }
  }
  console.log(`   ✓ 创建 ${people.length} 人\n`);

  // 2. 创建攻关单
  console.log('2. 创建攻关单...');
  const tickets = [];
  const ticketCount = Math.ceil(count * 1.5);
  for (let i = 0; i < ticketCount; i++) {
    const status = pick(STATUSES);
    const handler = people.length > 0 ? pick(people).properties['姓名'] : undefined;
    const leader = people.length > 0 ? pick(people).properties['姓名'] : undefined;
    try {
      const t = await post('/api/nodes/attackTicket', {
        标题: `MOCK-攻关单-${String(i + 1).padStart(3, '0')}`,
        状态: status,
        事件级别: pick(LEVELS),
        客户名称: pick(CUSTOMERS),
        问题单号: `PB${2026}${String(randInt(100000, 999999))}`,
        当前处理人: handler,
        攻关组长: leader,
        影响及现存风险: `模拟数据：这是第 ${i + 1} 个攻关单的影响描述`,
      });
      tickets.push(t);
    } catch (e) {
      console.warn(`   攻关单 #${i + 1} 创建失败: ${e.message}`);
    }
  }
  console.log(`   ✓ 创建 ${tickets.length} 张攻关单\n`);

  // 3. 创建贡献记录
  console.log('3. 创建贡献记录...');
  let contribCount = 0;
  if (people.length > 0) {
    const cCount = Math.ceil(count * 2);
    for (let i = 0; i < cCount; i++) {
      try {
        await post('/api/nodes/contribution', {
          贡献人: pick(people).properties['姓名'],
          贡献类型: pick(CONTRIB_TYPES),
          贡献等级: pick(CONTRIB_LEVELS),
          描述: `模拟贡献记录 #${i + 1}`,
          周期: pick(PERIODS),
          关联攻关单: tickets.length > 0 ? pick(tickets).properties['问题单号'] : undefined,
        });
        contribCount++;
      } catch (e) {
        // skip
      }
    }
  }
  console.log(`   ✓ 创建 ${contribCount} 条贡献记录\n`);

  // 4. 种子配置（如果配置中心为空）
  console.log('4. 检查配置中心...');
  try {
    const settingsRes = await fetch(`${API}/api/settings`);
    if (settingsRes.ok) {
      const existing = await settingsRes.json();
      if (Object.keys(existing).length === 0) {
        console.log('   配置中心为空，执行 settings-seed...');
        const { execSync } = await import('child_process');
        const seedPath = new URL('../settings-seed.mjs', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
        execSync(`node "${seedPath}" --api ${API}`, { stdio: 'inherit' });
      } else {
        console.log('   ✓ 配置中心已有数据，跳过');
      }
    }
  } catch (e) {
    console.warn(`   配置种子跳过: ${e.message}`);
  }

  console.log('\n=== 填充完成 ===');
  console.log(`  人员: ${people.length}`);
  console.log(`  攻关单: ${tickets.length}`);
  console.log(`  贡献记录: ${contribCount}`);
}

seed().catch(e => { console.error('填充失败:', e.message); process.exit(1); });
