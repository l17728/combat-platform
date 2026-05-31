#!/usr/bin/env node
/**
 * §v2.6 — Hermes LLM 端到端真跑评测 (golden set 15 题)
 *
 * 与 apps/backend/test/hermes-golden-set.e2e.test.ts 的区别:
 *   - 那个测「工具集是否能正确回答」(直调 callTool,不需要 LLM)
 *   - 本脚本测「LLM 是否能正确选工具 + 答出包含期望关键词的答案」(走 /api/hermes/ask)
 *
 * 用法:
 *   node scripts/hermes/test-llm-prod.mjs                       # 默认打本机 http://localhost:3001
 *   node scripts/hermes/test-llm-prod.mjs http://124.156.193.122:3001
 *   node scripts/hermes/test-llm-prod.mjs http://1.2.3.4:3001 admin admin123
 *
 * 通过门槛: 12/15 (80%)
 *
 * 评分规则:
 *   - HTTP 200 + answer 是非空字符串 → 算 +0.5 分
 *   - answer 含期望关键词中至少 1 个 → 再 +0.5 分(合计 1 分)
 *   - 抛错 / 超时 → 0 分
 */
import { setTimeout as delay } from "node:timers/promises";

const args = process.argv.slice(2);
const BASE = args[0] || process.env.HERMES_TEST_BASE || "http://localhost:3001";
const USER = args[1] || process.env.HERMES_TEST_USER || "admin";
const PASS = args[2] || process.env.HERMES_TEST_PASS || "admin123";
const TIMEOUT_MS = Number(process.env.HERMES_TEST_TIMEOUT_MS) || 120000;
const PASS_THRESHOLD = Number(process.env.HERMES_TEST_THRESHOLD) || 12;

/**
 * Golden set 15 题。expectAny: answer 含其一即算合规。
 * tool (可选): 期望 LLM 至少调过这个工具(trace 检查),只看不算分。
 */
const cases = [
  {
    id: "Q1",
    q: "系统里有哪些 nodeType?",
    expectAny: ["attackTicket", "person", "贡献", "节点", "节点类型"],
    tool: "list_node_types",
  },
  {
    id: "Q2",
    q: "attackTicket 有哪些字段?",
    expectAny: ["标题", "状态", "字段", "事件级别", "当前处理人"],
    tool: "describe_node_type",
  },
  { id: "Q3", q: "有多少员工?", expectAny: ["人", "个", "条", "员工", "数"], tool: "count_nodes" },
  { id: "Q4", q: "处理中的攻关单有哪些?", expectAny: ["处理中", "攻关单", "标题", "未找到"], tool: "query_nodes" },
  { id: "Q5", q: "P0 或 P1 级别的攻关单", expectAny: ["P0", "P1", "事件级别", "未找到"], tool: "query_nodes" },
  { id: "Q6", q: "搜支付相关的内容", expectAny: ["支付", "未找到", "无", "条"], tool: "search_text" },
  { id: "Q7", q: "admin 改过哪些?", expectAny: ["admin", "操作", "变更", "条", "未找到"], tool: "get_audit" },
  {
    id: "Q8",
    q: "schema 字段最近有什么修改?",
    expectAny: ["schema", "字段", "未找到", "变更", "条"],
    tool: "get_audit",
  },
  {
    id: "Q9",
    q: "攻关单按状态分组各多少?",
    expectAny: ["处理中", "已解决", "待响应", "已关闭", "状态"],
    tool: "aggregate",
  },
  {
    id: "Q10",
    q: "现在大盘是什么情况?",
    expectAny: ["攻关单", "活跃", "条", "贡献", "进度", "未找到"],
    tool: "dashboard_metric",
  },
  { id: "Q11", q: "张三参加过哪些攻关?", expectAny: ["张三", "攻关", "条", "未找到"], tool: "search_text" },
  { id: "Q12", q: "本月新增的攻关单", expectAny: ["攻关单", "本月", "新增", "条", "未找到"], tool: "query_nodes" },
  {
    id: "Q13",
    q: "团队贡献按等级排名",
    expectAny: ["核心", "关键", "普通", "贡献", "团队", "未找到"],
    tool: "aggregate",
  },
  {
    id: "Q14",
    q: "最近一周升级过的攻关单",
    expectAny: ["升级", "攻关单", "本周", "最近", "条", "未找到"],
    tool: "get_audit",
  },
  { id: "Q15", q: "李四负责哪些攻关单?", expectAny: ["李四", "攻关单", "负责", "条", "未找到"], tool: "query_nodes" },
];

function logStep(step, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${step}] ${msg}`);
}

async function login() {
  logStep("auth", `POST ${BASE}/api/auth/login as ${USER}`);
  const resp = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`login failed HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  if (!data?.token) throw new Error(`login returned no token: ${JSON.stringify(data).slice(0, 200)}`);
  logStep("auth", `token acquired (${data.token.length} chars)`);
  return data.token;
}

async function ask(token, question, mode = "tool") {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${BASE}/api/hermes/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ question, mode }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const text = await resp.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`non-JSON response: ${text.slice(0, 200)}`);
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(body?.error || text).slice(0, 200)}`);
    return body;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

function evaluate(answerObj, expectAny) {
  const answer = String(answerObj?.answer ?? "");
  if (!answer.trim()) return { score: 0, reason: "empty answer" };
  const hit = expectAny.find((kw) => answer.includes(kw));
  if (hit) return { score: 1, reason: `match "${hit}"` };
  return { score: 0.5, reason: "answered but no keyword hit" };
}

async function main() {
  console.log("===========================================");
  console.log(`Hermes LLM 端到端评测 — ${BASE}`);
  console.log(`Pass threshold: ${PASS_THRESHOLD}/${cases.length}`);
  console.log("===========================================\n");

  let token;
  try {
    token = await login();
  } catch (e) {
    console.error(`Auth failed: ${e.message}`);
    process.exit(2);
  }

  // 健康检查
  try {
    const r = await fetch(`${BASE}/api/health`);
    logStep("health", `GET /api/health → ${r.status}`);
  } catch (e) {
    logStep("health", `WARN: ${e.message}`);
  }

  const results = [];
  for (const c of cases) {
    const t0 = Date.now();
    try {
      const ans = await ask(token, c.q, "tool");
      const elapsed = Date.now() - t0;
      const ev = evaluate(ans, c.expectAny);
      const toolsUsed = (ans.trace || []).map((t) => t.tool);
      const expectedToolHit = c.tool ? toolsUsed.includes(c.tool) : null;
      results.push({
        id: c.id,
        q: c.q,
        ok: ev.score >= 1,
        partial: ev.score === 0.5,
        score: ev.score,
        reason: ev.reason,
        engine: ans.engine,
        toolsUsed,
        expectedTool: c.tool,
        expectedToolHit,
        ms: elapsed,
        fallback: ans.fallback_reason,
        answer: String(ans.answer ?? "").slice(0, 120),
      });
      const mark = ev.score >= 1 ? "✓" : ev.score >= 0.5 ? "~" : "✗";
      console.log(
        `${mark} ${c.id} (${elapsed}ms, engine=${ans.engine}${ans.fallback_reason ? "/fb" : ""}, tools=[${toolsUsed.join(",")}]) — ${ev.reason}`
      );
      console.log(`    Q: ${c.q}`);
      console.log(`    A: ${String(ans.answer ?? "").slice(0, 140)}`);
    } catch (e) {
      const elapsed = Date.now() - t0;
      results.push({ id: c.id, q: c.q, ok: false, partial: false, score: 0, reason: e.message, ms: elapsed });
      console.log(`✗ ${c.id} (${elapsed}ms) — ERROR ${e.message}`);
    }
    // 题间稍稍间隔,避免上游限流
    await delay(200);
  }

  const totalScore = results.reduce((s, r) => s + (r.score || 0), 0);
  const fullPass = results.filter((r) => r.ok).length;
  const partial = results.filter((r) => r.partial).length;

  console.log("\n===========================================");
  console.log(`汇总 (engines):`);
  const byEngine = {};
  for (const r of results) {
    if (!r.engine) continue;
    byEngine[r.engine] = (byEngine[r.engine] || 0) + 1;
  }
  for (const [e, n] of Object.entries(byEngine)) console.log(`  ${e}: ${n}`);

  console.log(`\n通过 (1.0 分): ${fullPass}/${cases.length}`);
  console.log(`半通过 (0.5 分): ${partial}`);
  console.log(`累计得分: ${totalScore.toFixed(1)}/${cases.length}`);
  console.log(`门槛: ${PASS_THRESHOLD}/${cases.length}`);
  console.log("===========================================");

  if (fullPass >= PASS_THRESHOLD) {
    console.log("✓ PASS");
    process.exit(0);
  } else {
    console.log("✗ FAIL — below threshold");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal:", e.stack || e.message);
  process.exit(2);
});
