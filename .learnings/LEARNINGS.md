# Learnings Log

## [LRN-20260526-001] best_practice

**Logged**: 2026-05-26T10:30:00+08:00
**Priority**: critical
**Status**: promoted
**Area**: tests

### Summary
递归收敛原则（举一反三）：发现一个错误，消灭一类错误，递归检查直到零失败

### Details
这是所有开发工作的核心元原则，适用于测试、代码、部署等一切场景。

**错误模式**：看到测试失败只修那一个测试，不检查同类问题是否存在于其他20+个测试文件中。
**正确做法**：
1. **识别根因模式**（不是症状）— 如 `row.locator('a').filter({ hasText: '编辑' })` 匹配到姓名链接和编辑按钮两个元素
2. **搜索整个代码库的所有实例** — grep 所有 `.spec.ts` 文件中的同类反模式
3. **修复所有实例** — 统一用 `opsCell(row).locator('a')` 限定到操作列最后一个 td
4. **检查修复是否引入新问题** — 如 opsCell() 在没有固定列的表格上是否正常
5. **递归**：如果发现新问题，回到步骤1
6. **收敛**：只有零失败时才停止

**已发现的反模式类别**：
- `row.locator('a')` 未限定操作列 → strict mode 多元素违规
- `drawer.getByLabel('姓名')` 在 Ant Design Form.Item 中不可靠 → 用 `getByPlaceholder()`
- `page.getByText('详情部门')` 匹配到 Descriptions label 和 value 两个元素 → 用 `.first()` 或更精确选择器

### Suggested Action
1. 每次修复测试失败时，grep 全部测试文件中的同类模式
2. 新建工具函数 `opsCell()` 到 helpers.ts 并全局替换
3. 修复后运行全量测试验证无回归

### Metadata
- Source: user_feedback
- Related Files: apps/frontend-v2/e2e/*.spec.ts, apps/frontend-v2/e2e/helpers.ts
- Tags: testing, e2e, recursive-convergence, anti-pattern
- See Also: LRN-20260526-002 (opsCell helper function)

**Promoted**: AGENTS.md (Core Development Principles #2)

---

## [LRN-20260526-002] best_practice

**Logged**: 2026-05-26T10:30:00+08:00
**Priority**: high
**Status**: pending
**Area**: tests

### Summary
E2E 测试中操作列选择器必须用 opsCell() 限定到最后一个 td，避免匹配到姓名/标题列的链接

### Details
Ant Design Table 中，姓名/标题列通常是 `<a>` 链接，操作列也有 `<a>` 链接（编辑/删除/荣誉等）。
当使用 `row.locator('a').filter({ hasText: '编辑' })` 时，如果姓名恰好含"编辑"二字，会匹配到两个元素触发 strict mode 违规。

**反模式**（会失败）：
```ts
row.locator('a').filter({ hasText: '编辑' }).click()
row.locator('a').filter({ hasText: '荣誉' }).click()
row.locator('a').last().click()  // 假设最后一个 a 就是操作列
```

**正确模式**：
```ts
function opsCell(row: Locator) {
  return row.locator('td').last();
}
opsCell(row).locator('a').filter({ hasText: '编辑' }).click()
```

### Suggested Action
将 `opsCell()` 添加到 helpers.ts，全局搜索替换所有测试文件中的 `row.locator('a')` 反模式。

### Metadata
- Source: error_recovery
- Related Files: apps/frontend-v2/e2e/helpers.ts, apps/frontend-v2/e2e/*.spec.ts
- Tags: e2e, playwright, ant-design, selector, anti-pattern

---

## [LRN-20260525-001] best_practice

**Logged**: 2026-05-25T23:55:00+08:00
**Priority**: high
**Status**: promoted
**Area**: infra

### Summary
部署到目标机应通过跳板机 git clone + scp，而非 stdin 管道传输

### Details
部署架构为：开发机 → 跳板机(47.103.99.229) → 目标机(60.204.199.234)

**失败路径**：`deploy.mjs` 的 `stdinPut()` 通过 SSH exec 管道 (`cat > remote`) 传输 tar.gz 文件（~643KB）。在跳板机网络上，SSH exec stdin 管道传输二进制数据极不稳定，反复超时（10 分钟+）。

**成功路径**：在跳板机上从 GitHub 拉代码 → 打包 → scp 到目标机：
1. 跳板机: `git clone https://github.com/l17728/combat-platform.git /tmp/combat-deploy`
2. 跳板机: `cd /tmp/combat-deploy && git archive --format=tar.gz -o /tmp/combat-v2.tar.gz HEAD`
3. 跳板机: `scp /tmp/combat-v2.tar.gz root@60.204.199.234:/tmp/`
4. 目标机: `cd /opt/combat-v2 && tar xzf /tmp/combat-v2.tar.gz`
5. 目标机: `npm install && cd apps/frontend-v2 && npm run build`
6. 目标机: `systemctl restart combat-v2`

### Suggested Action
更新 `scripts/deploy-v2/deploy.mjs` 的 doDeploy 函数，将 stdinPut 上传方式替换为跳板机 git clone + archive + scp 方式。

### Metadata
- Source: error_recovery
- Related Files: scripts/deploy-v2/deploy.mjs
- Tags: deploy, ssh, scp, relay, timeout

**Promoted**: AGENTS.md (部署架构部分)

---
