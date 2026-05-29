#!/usr/bin/env node
// migrate:export — 全量导出所有 nodeType 为 xlsx 文件
// 用法: node scripts/migrate/export.mjs [--api http://localhost:3001] [--out ./migration-output/]
// 前提: 后端 API 正在运行

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const API = process.env.COMBAT_API || process.argv.includes('--api')
  ? process.argv[process.argv.indexOf('--api') + 1]
  : 'http://localhost:3001';

const getOut = () => {
  const i = process.argv.indexOf('--out');
  return i >= 0 ? process.argv[i + 1] : './migration-output';
};

const NODE_TYPES = [
  'person', 'attackTicket', 'contribution', 'teamContribution', 'oncall',
  'releasePackage', 'weightFile', 'dailyTask',
  'incidentTracking', 'changeIssue', 'issue400', 'issue5xx',
  'p3Incident', 'alarmGovernance', 'domain', 'experience',
  'emailGroup',
];

async function countNodes(nodeType) {
  const res = await fetch(`${API}/api/nodes/${nodeType}`);
  if (!res.ok) return 0;
  const nodes = await res.json();
  return Array.isArray(nodes) ? nodes.length : 0;
}

async function exportType(nodeType) {
  const res = await fetch(`${API}/api/export/${nodeType}`);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`导出 ${nodeType} 失败: ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function exportAll() {
  const outDir = getOut();
  console.log(`=== 全量数据导出 (API: ${API}) ===\n`);

  await mkdir(outDir, { recursive: true });

  // Count all
  console.log('统计数据量...');
  const withData = [];
  for (const nt of NODE_TYPES) {
    const c = await countNodes(nt);
    if (c > 0) withData.push({ nodeType: nt, count: c });
  }

  if (withData.length === 0) {
    console.log('无数据可导出。');
    return;
  }

  console.log(`\n有数据的类型 (${withData.length} 个):`);
  for (const { nodeType, count } of withData) {
    console.log(`  ${nodeType}: ${count} 条`);
  }
  console.log('');

  // Export each
  const manifest = { exportedAt: new Date().toISOString(), files: [] };
  for (const { nodeType, count } of withData) {
    console.log(`导出 ${nodeType} (${count} 条)...`);
    try {
      const buf = await exportType(nodeType);
      if (buf) {
        const filename = `${nodeType}.xlsx`;
        await writeFile(join(outDir, filename), buf);
        manifest.files.push({ nodeType, count, filename });
        console.log(`  ✓ ${filename} (${buf.length} bytes)`);
      }
    } catch (e) {
      console.warn(`  ✗ 导出失败: ${e.message}`);
    }
  }

  // Write manifest
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\n✓ manifest.json 已写入`);
  console.log(`\n=== 导出完成: ${manifest.files.length} 个文件 → ${outDir} ===`);
}

exportAll().catch(e => { console.error('导出失败:', e.message); process.exit(1); });
