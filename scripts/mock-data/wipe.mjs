#!/usr/bin/env node
// mock:wipe — 清除所有模拟数据（人员、攻关单、贡献记录等全部节点）
// 用法: node scripts/mock-data/wipe.mjs [--api http://localhost:3001] [--yes]
// 前提: 后端 API 正在运行
// 注意: 此操作不可逆！--yes 跳过确认提示

const API = process.env.COMBAT_API || process.argv.includes('--api')
  ? process.argv[process.argv.indexOf('--api') + 1]
  : 'http://localhost:3001';

const skipConfirm = process.argv.includes('--yes');

const NODE_TYPES = [
  'attackTicket', 'person', 'contribution', 'oncall',
  'releasePackage', 'weightFile', 'dailyTask',
  'incidentTracking', 'changeIssue', 'issue400', 'issue5xx',
  'p3Incident', 'alarmGovernance', 'domain', 'experience',
  'emailGroup',
];

async function listNodes(nodeType) {
  const res = await fetch(`${API}/api/nodes/${nodeType}`);
  if (!res.ok) return [];
  return res.json();
}

async function deleteNode(id) {
  const res = await fetch(`${API}/api/nodes/${id}`, { method: 'DELETE' });
  return res.ok;
}

async function wipe() {
  // Count first
  console.log(`=== 清除模拟数据 (API: ${API}) ===\n`);
  console.log('正在统计数据量...');
  const counts = {};
  let total = 0;
  for (const nt of NODE_TYPES) {
    const nodes = await listNodes(nt);
    counts[nt] = nodes.length;
    total += nodes.length;
  }

  console.log('数据统计:');
  for (const [nt, c] of Object.entries(counts)) {
    if (c > 0) console.log(`  ${nt}: ${c} 条`);
  }
  console.log(`  合计: ${total} 条\n`);

  if (total === 0) {
    console.log('无数据需要清除。');
    return;
  }

  if (!skipConfirm) {
    console.log('⚠️  此操作不可逆！所有节点及关联数据将被永久删除。');
    console.log('使用 --yes 参数跳过确认。');
    // In non-interactive mode, require --yes
    console.log('\n请添加 --yes 参数确认清除。');
    process.exit(0);
  }

  console.log('开始清除...');
  let deleted = 0;
  for (const nt of NODE_TYPES) {
    const nodes = await listNodes(nt);
    if (nodes.length === 0) continue;
    for (const n of nodes) {
      try {
        await deleteNode(n.id);
        deleted++;
        if (deleted % 50 === 0) process.stdout.write(`  已删除 ${deleted}/${total}...\n`);
      } catch (e) {
        // skip
      }
    }
  }

  console.log(`\n=== 清除完成: 已删除 ${deleted}/${total} 条 ===`);
}

wipe().catch(e => { console.error('清除失败:', e.message); process.exit(1); });
