#!/usr/bin/env node
// settings:seed — 填充配置中心初始数据
// 用法: node scripts/settings-seed.mjs [--api http://localhost:3001]

const API = process.env.COMBAT_API || process.argv.includes('--api')
  ? process.argv[process.argv.indexOf('--api') + 1]
  : 'http://localhost:3001';

async function put(key, values, label) {
  const res = await fetch(`${API}/api/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values, label }),
  });
  if (!res.ok) throw new Error(`PUT ${key} → ${res.status}: ${await res.text()}`);
  console.log(`  ✓ ${key} (${values.length} 选项)${label ? ` [${label}]` : ''}`);
}

async function seed() {
  console.log(`=== 配置中心种子数据 (API: ${API}) ===\n`);

  await put('状态', ['待响应', '处理中', '进行中', '已解决', '已关闭'], '攻关单状态');
  await put('事件级别', ['P1', 'P2', 'P3', 'P4', 'P4A', 'P4B'], '事件级别');
  await put('贡献类型', ['实施', '发现', '协调', '指导', '支持'], '贡献类型');
  await put('贡献等级', ['核心', '关键', '普通'], '贡献等级');
  await put('求助分类', ['环境', '领域专家', '团队协作', '资源'], '求助网络分类');
  await put('求助状态', ['待确认', '支持中', '已完成', '已撤销'], '求助节点状态');
  await put('求助中心状态', ['待回复', '已回复'], '求助中心筛选状态');
  await put('日报类型', ['进展通报', '风险通报'], '攻关日报类型');
  await put('是否需CCB', ['是', '否'], '是否需CCB');
  await put('风险等级', ['高', '中', '低'], '风险等级');
  await put('优先级', ['高', '中', '低'], '优先级');
  await put('信息分类', ['通知', '公告', '经验', '预警', '其他'], '信息广场分类');
  await put('重要程度', ['重要', '一般', '普通'], '信息重要程度');
  await put('Bug 状态', ['待处理', '处理中', '已解决', '已关闭'], '问题反馈状态');
  await put('Bug 严重程度', ['严重', '较高', '一般', '建议'], '问题反馈严重程度');
  await put('提案状态', ['待审批', '已通过', '已拒绝'], '关系审批状态');
  await put('提醒状态', ['待发送', '已发送', '已忽略'], '跟催提醒状态');
  await put('团队角色', ['组长', '组员'], '攻关团队成员角色');

  console.log('\n=== 种子数据写入完成 ===');
}

seed().catch(e => { console.error('失败:', e.message); process.exit(1); });
