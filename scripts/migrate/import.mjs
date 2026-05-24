#!/usr/bin/env node
// migrate:import — 从 xlsx 文件全量导入（upsert 语义）
// 用法: node scripts/migrate/import.mjs [--api http://localhost:3001] [--dir ./migration-output/] [--dryRun]
// 前提: 后端 API 正在运行
// 导入目录中需有 manifest.json 或自动扫描所有 .xlsx 文件

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const API = process.env.COMBAT_API || process.argv.includes('--api')
  ? process.argv[process.argv.indexOf('--api') + 1]
  : 'http://localhost:3001';

const getDir = () => {
  const i = process.argv.indexOf('--dir');
  return i >= 0 ? process.argv[i + 1] : './migration-output';
};

const isDryRun = process.argv.includes('--dryRun');

async function importFile(nodeType, filePath) {
  const fileBuf = await readFile(filePath);
  const formData = new FormData();
  formData.append('file', new Blob([fileBuf]), `${nodeType}.xlsx`);

  const params = new URLSearchParams();
  params.set('type', nodeType);
  if (isDryRun) params.set('dryRun', '1');

  const res = await fetch(`${API}/api/import?${params.toString()}`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`导入 ${nodeType} 失败: ${res.status} ${text}`);
  }
  return res.json();
}

async function importAll() {
  const dir = getDir();
  console.log(`=== 全量数据导入 (API: ${API}, 目录: ${dir}${isDryRun ? ', 预览模式' : ''}) ===\n`);

  // Discover files
  let files;
  try {
    const manifestPath = join(dir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
    files = manifest.files.map(f => ({ nodeType: f.nodeType, filename: f.filename }));
    console.log(`从 manifest.json 发现 ${files.length} 个文件\n`);
  } catch {
    // No manifest, scan directory
    const entries = await readdir(dir);
    const xlsxFiles = entries.filter(e => e.endsWith('.xlsx'));
    files = xlsxFiles.map(f => ({
      nodeType: f.replace('.xlsx', ''),
      filename: f,
    }));
    console.log(`扫描目录发现 ${files.length} 个 xlsx 文件\n`);
  }

  if (files.length === 0) {
    console.log('未发现可导入的文件。');
    return;
  }

  // Import each
  let totalCreated = 0, totalUpdated = 0, totalSkipped = 0;
  for (const { nodeType, filename } of files) {
    const filePath = join(dir, filename);
    console.log(`导入 ${nodeType} (${filename})...`);
    try {
      const result = await importFile(nodeType, filePath);
      const created = result.created ?? result.willCreate ?? 0;
      const updated = result.updated ?? result.willUpdate ?? 0;
      const skipped = result.skipped ?? 0;
      totalCreated += created;
      totalUpdated += updated;
      totalSkipped += skipped;

      if (isDryRun) {
        console.log(`  预览: 将创建 ${created}, 更新 ${updated}, 跳过 ${skipped}`);
      } else {
        console.log(`  ✓ 创建 ${created}, 更新 ${updated}, 跳过 ${skipped}`);
      }
    } catch (e) {
      console.warn(`  ✗ 导入失败: ${e.message}`);
    }
  }

  console.log(`\n=== 导入${isDryRun ? '预览' : '完成'} ===`);
  console.log(`  创建: ${totalCreated}`);
  console.log(`  更新: ${totalUpdated}`);
  console.log(`  跳过: ${totalSkipped}`);
}

importAll().catch(e => { console.error('导入失败:', e.message); process.exit(1); });
