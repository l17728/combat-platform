#!/usr/bin/env node
// demo-seed — 全功能演示数据填充，覆盖所有页面和功能
// 用法: node scripts/mock-data/demo-seed.mjs [--api http://localhost:3001]
// 前提: 后端 API 正在运行，数据库为空或可覆盖

import { readFileSync } from "node:fs";

const API =
  process.env.COMBAT_API || process.argv.includes("--api")
    ? process.argv[process.argv.indexOf("--api") + 1]
    : "http://localhost:3001";

const markdownDemo = readFileSync(new URL("./markdown-demo.md", import.meta.url), "utf8");
const raciMatrix = readFileSync(new URL("./raci-matrix.md", import.meta.url), "utf8");

const headers = { "Content-Type": "application/json" };

async function login() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  if (!res.ok) throw new Error(`登录失败: ${res.status}`);
  const data = await res.json();
  headers["Authorization"] = `Bearer ${data.token}`;
  headers["X-Role"] = data.user.role;
  headers["Referer"] = `${API}/`;
  console.log(`   已登录 (${data.user.displayName})\n`);
}

async function post(path, body) {
  const res = await fetch(`${API}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function put(path, body) {
  const res = await fetch(`${API}${path}`, { method: "PUT", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`PUT ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function get(path) {
  const res = await fetch(`${API}${path}`, { headers });
  if (!res.ok) return [];
  return res.json();
}

async function patch(path, body) {
  const res = await fetch(`${API}${path}`, { method: "PATCH", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function seed() {
  console.log(`\n🚀 全功能演示数据填充 (API: ${API})\n`);
  await login();

  // ═══════════════════════════════════════════
  // 1. 配置中心 (ConfigCenter page)
  // ═══════════════════════════════════════════
  console.log("1. 配置中心 — 填充下拉选项...");
  const settings = {
    状态: { values: ["待响应", "处理中", "进行中", "已解决", "已关闭"], label: "攻关单状态" },
    事件级别: { values: ["P1", "P2", "P3", "P4", "P4A", "P4B"], label: "事件级别" },
    贡献类型: { values: ["实施", "发现", "协调", "指导", "支持"], label: "贡献类型" },
    贡献等级: { values: ["核心", "关键", "普通"], label: "贡献等级" },
    求助分类: { values: ["环境", "领域专家", "团队协作", "资源"], label: "求助网络分类" },
    求助状态: { values: ["待确认", "支持中", "已完成", "已撤销"], label: "求助节点状态" },
    求助中心状态: { values: ["待回复", "已回复"], label: "求助中心筛选状态" },
    日报类型: { values: ["进展通报", "风险通报"], label: "攻关日报类型" },
    重要程度: { values: ["重要", "一般", "普通"], label: "信息重要程度" },
    信息分类: { values: ["通知", "公告", "经验", "预警", "其他"], label: "信息分类" },
  };
  for (const [key, val] of Object.entries(settings)) {
    await put(`/api/settings/${encodeURIComponent(key)}`, val);
  }
  console.log(`   ✓ ${Object.keys(settings).length} 个配置项\n`);

  // ═══════════════════════════════════════════
  // 2. 用户管理 (UserManagement page)
  // ═══════════════════════════════════════════
  console.log("2. 用户管理 — 创建演示用户...");
  const users = [
    { username: "admin", password: "admin123", displayName: "系统管理员", role: "admin" },
    { username: "zhangsan", password: "123456", displayName: "张三", role: "leader" },
    { username: "lisi", password: "123456", displayName: "李四", role: "normal" },
    { username: "wangwu", password: "123456", displayName: "王五", role: "normal" },
  ];
  for (const u of users) {
    try {
      await post("/api/auth/register", u);
      console.log(`   ✓ ${u.displayName} (${u.role})`);
    } catch (e) {
      if (e.message.includes("409") || e.message.includes("已存在")) console.log(`   - ${u.displayName} 已存在`);
      else console.warn(`   ✗ ${u.displayName}: ${e.message}`);
    }
  }
  console.log();

  // ═══════════════════════════════════════════
  // 3. 全员名单 (PeopleList page) — 20人
  // ═══════════════════════════════════════════
  console.log("3. 全员名单 — 创建 20 名成员...");
  const peopleData = [
    { 姓名: "张三", 工号: "EMP001", 邮箱: "zhangsan@combat.com", 部门: "网络部", 角色: "组长" },
    { 姓名: "李四", 工号: "EMP002", 邮箱: "lisi@combat.com", 部门: "网络部", 角色: "高级工程师" },
    { 姓名: "王五", 工号: "EMP003", 邮箱: "wangwu@combat.com", 部门: "平台部", 角色: "工程师" },
    { 姓名: "赵敏", 工号: "EMP004", 邮箱: "zhaomin@combat.com", 部门: "安全部", 角色: "安全专家" },
    { 姓名: "陈静", 工号: "EMP005", 邮箱: "chenjing@combat.com", 部门: "数据部", 角色: "数据分析师" },
    { 姓名: "杨磊", 工号: "EMP006", 邮箱: "yanglei@combat.com", 部门: "运维部", 角色: "运维工程师" },
    { 姓名: "黄浩", 工号: "EMP007", 邮箱: "huanghao@combat.com", 部门: "研发部", 角色: "架构师" },
    { 姓名: "周琳", 工号: "EMP008", 邮箱: "zhoulin@combat.com", 部门: "平台部", 角色: "项目经理" },
    { 姓名: "吴涛", 工号: "EMP009", 邮箱: "wutao@combat.com", 部门: "网络部", 角色: "网络工程师" },
    { 姓名: "徐明", 工号: "EMP010", 邮箱: "xuming@combat.com", 部门: "安全部", 角色: "渗透测试工程师" },
    { 姓名: "孙丽", 工号: "EMP011", 邮箱: "sunli@combat.com", 部门: "数据部", 角色: "DBA" },
    { 姓名: "马超", 工号: "EMP012", 邮箱: "machao@combat.com", 部门: "研发部", 角色: "前端工程师" },
    { 姓名: "朱峰", 工号: "EMP013", 邮箱: "zhufeng@combat.com", 部门: "运维部", 角色: "SRE" },
    { 姓名: "胡婷", 工号: "EMP014", 邮箱: "huting@combat.com", 部门: "平台部", 角色: "测试工程师" },
    { 姓名: "郭鑫", 工号: "EMP015", 邮箱: "guoxin@combat.com", 部门: "网络部", 角色: "网络工程师" },
    { 姓名: "林鹏", 工号: "EMP016", 邮箱: "linpeng@combat.com", 部门: "安全部", 角色: "安全工程师" },
    { 姓名: "何雪", 工号: "EMP017", 邮箱: "hexue@combat.com", 部门: "研发部", 角色: "后端工程师" },
    { 姓名: "高飞", 工号: "EMP018", 邮箱: "gaofei@combat.com", 部门: "数据部", 角色: "算法工程师" },
    { 姓名: "罗军", 工号: "EMP019", 邮箱: "luojun@combat.com", 部门: "运维部", 角色: "系统工程师" },
    { 姓名: "刘洋", 工号: "EMP020", 邮箱: "liuyang@combat.com", 部门: "平台部", 角色: "技术总监" },
    // 重复姓名用于人员合并和关系审批演示
    { 姓名: "张三", 工号: "EXT001", 邮箱: "zhangsan_ext@partner.com", 部门: "外部团队", 角色: "外部专家" },
    { 姓名: "赵敏", 工号: "EXT002", 邮箱: "zhaomin_ext@partner.com", 部门: "外部协作", 角色: "顾问" },
  ];
  const people = [];
  for (const p of peopleData) {
    try {
      people.push(await post("/api/nodes/person", p));
    } catch (e) {
      /* skip */
    }
  }
  console.log(`   ✓ ${people.length} 名成员（含 2 对重复姓名用于合并演示）\n`);

  // ═══════════════════════════════════════════
  // 4. 攻关作战台 (AttackList + AttackDetail) — 30张单子
  // ═══════════════════════════════════════════
  console.log("4. 攻关作战台 — 创建 30 张攻关单（覆盖所有状态和级别）...");
  const ticketTitles = [
    { title: "华为云MaaS服务503故障", customer: "华为云", level: "P1", status: "待响应" },
    { title: "阿里云OSS上传超时问题", customer: "阿里云", level: "P1", status: "处理中" },
    { title: "腾讯云CDB主从切换失败", customer: "腾讯云", level: "P1", status: "进行中" },
    { title: "中国移动5G核心网信令异常", customer: "中国移动", level: "P1", status: "已解决" },
    { title: "国家电网调度系统响应延迟", customer: "国家电网", level: "P1", status: "已关闭" },
    { title: "工商银行手机银行登录超时", customer: "工商银行", level: "P2", status: "待响应" },
    { title: "华为云ECS实例创建失败", customer: "华为云", level: "P2", status: "处理中" },
    { title: "阿里云SLB健康检查异常", customer: "阿里云", level: "P2", status: "进行中" },
    { title: "腾讯云TRTCC音视频卡顿", customer: "腾讯云", level: "P2", status: "已解决" },
    { title: "中国移动短信网关拥塞", customer: "中国移动", level: "P2", status: "已关闭" },
    { title: "华为云ModelArts训练任务OOM", customer: "华为云", level: "P3", status: "待响应" },
    { title: "阿里云DataWorks数据倾斜", customer: "阿里云", level: "P3", status: "处理中" },
    { title: "腾讯云CKV集群脑裂", customer: "腾讯云", level: "P3", status: "进行中" },
    { title: "国家电网边缘网关断连", customer: "国家电网", level: "P3", status: "已解决" },
    { title: "工商银行风控模型误报率高", customer: "工商银行", level: "P3", status: "已关闭" },
    { title: "华为云CES监控数据丢失", customer: "华为云", level: "P4", status: "待响应" },
    { title: "阿里云RAM权限策略失效", customer: "阿里云", level: "P4", status: "处理中" },
    { title: "腾讯云API网关限流误触", customer: "腾讯云", level: "P4", status: "已解决" },
    { title: "中国移动DNS解析延迟升高", customer: "中国移动", level: "P4", status: "已关闭" },
    { title: "华为云DCS缓存穿透", customer: "华为云", level: "P4A", status: "待响应" },
    { title: "阿里云NAS文件系统只读", customer: "阿里云", level: "P4A", status: "处理中" },
    { title: "腾讯云TDSQL慢查询暴增", customer: "腾讯云", level: "P4A", status: "已解决" },
    { title: "国家电网光伏预测精度下降", customer: "国家电网", level: "P4B", status: "待响应" },
    { title: "工商银行对账系统超时", customer: "工商银行", level: "P4B", status: "处理中" },
    { title: "华为云DIS数据积压", customer: "华为云", level: "P4B", status: "已关闭" },
    { title: "阿里云FC冷启动耗时长", customer: "阿里云", level: "P3", status: "待响应" },
    { title: "腾讯云COS跨域访问失败", customer: "腾讯云", level: "P4", status: "处理中" },
    { title: "中国移动物联网设备离线", customer: "中国移动", level: "P2", status: "进行中" },
    { title: "国家电网SCADA数据延迟", customer: "国家电网", level: "P3", status: "处理中" },
    { title: "工商银行支付链路偶发504", customer: "工商银行", level: "P1", status: "进行中" },
  ];

  const tickets = [];
  for (let i = 0; i < ticketTitles.length; i++) {
    const t = ticketTitles[i];
    const handler = pick(people).properties["姓名"];
    const leader = pick(people).properties["姓名"];
    try {
      const ticket = await post("/api/nodes/attackTicket", {
        标题: t.title,
        状态: t.status,
        事件级别: t.level,
        客户名称: t.customer,
        问题单号: `PB2026${String(randInt(100000, 999999))}`,
        事件单号: `EV2026${String(randInt(100000, 999999))}`,
        当前处理人: handler,
        攻关组长: leader,
        攻关申请人: pick(people).properties["姓名"],
        影响及现存风险: `${t.customer}${t.title}影响范围较大，需紧急处理。当前已影响${randInt(2, 10)}个租户的业务运行，SLA指标可能不达标。`,
      });
      tickets.push({ ...ticket, _meta: t });
    } catch (e) {
      console.warn(`   ✗ ${t.title}: ${e.message}`);
    }
  }
  console.log(`   ✓ ${tickets.length} 张攻关单\n`);

  // ═══════════════════════════════════════════
  // 5. 进展同步 — 为每张单子追加2-5条进展
  // ═══════════════════════════════════════════
  console.log("5. 进展同步 — 追加进展记录...");
  const progressTemplates = [
    "已收到客户反馈，正在确认问题范围和影响面",
    "初步排查：确认是后端服务超时导致，已定位到相关日志",
    "已联系服务端团队排查，预计2小时内给出修复方案",
    "修复方案已确定：调整连接池参数并扩容实例，正在执行",
    "已完成修复，所有租户恢复正常，持续监控中",
    "根因分析：连接池耗尽导致请求排队，触发级联超时",
    "已协调DBA团队排查数据库慢查询，发现3条慢SQL",
    "正在与客户同步最新进展，客户表示理解并希望尽快解决",
    "已完成灰度验证，准备全量发布",
    "全量发布完成，系统运行稳定，各项指标正常",
  ];
  let progressCount = 0;
  for (const ticket of tickets) {
    const count = randInt(2, 5);
    for (let j = 0; j < count; j++) {
      try {
        await post(`/api/nodes/${ticket.id}/progress`, {
          content: progressTemplates[j % progressTemplates.length],
          statusSnapshot: ticket._meta.status,
          actor: pick(people).properties["姓名"],
        });
        progressCount++;
      } catch (e) {
        /* skip */
      }
    }
  }
  console.log(`   ✓ ${progressCount} 条进展记录\n`);

  // ═══════════════════════════════════════════
  // 6. 贡献录入 (Contributions page) — 40条
  // ═══════════════════════════════════════════
  console.log("6. 贡献录入 — 创建 40 条贡献记录...");
  const contribDescs = [
    "主导完成根因分析并制定修复方案",
    "协调跨部门资源推动问题解决",
    "第一时间发现异常并触发告警",
    "编写自动化脚本加速排查过程",
    "指导新人完成测试验证工作",
    "提供领域专业知识支持决策",
    "优化监控系统提升故障发现速度",
    "设计并实施容灾切换方案",
    "完成客户沟通和期望管理",
    "支持7x24小时值班保障",
  ];
  const periods = ["2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2"];
  let contribCount = 0;
  const contribHeaders = { ...headers, "X-Role": "leader" };
  for (let i = 0; i < 40; i++) {
    try {
      const person = pick(people);
      const res = await fetch(`${API}/api/nodes/contribution`, {
        method: "POST",
        headers: contribHeaders,
        body: JSON.stringify({
          贡献人: person.properties["姓名"],
          贡献类型: pick(["实施", "发现", "协调", "指导", "支持"]),
          贡献等级: pick(["核心", "关键", "普通"]),
          描述: pick(contribDescs),
          周期: pick(periods),
          关联攻关单: tickets.length > 0 ? pick(tickets).properties["问题单号"] : undefined,
        }),
      });
      if (res.ok) contribCount++;
    } catch (e) {
      /* skip */
    }
  }
  console.log(`   ✓ ${contribCount} 条贡献记录\n`);

  // ═══════════════════════════════════════════
  // 6b. 团队贡献 (teamContribution) — ~10条
  // ═══════════════════════════════════════════
  console.log("6b. 团队贡献 — 创建团队贡献记录...");
  const teamNames = [
    "攻坚突击队",
    "护航保障队",
    "数据攻坚组",
    "网络应急队",
    "安全防护组",
    "平台护航组",
    "算法优化组",
    "运维保障队",
    "跨域协同组",
    "客户支撑队",
  ];
  const teamDescs = [
    "团队协同攻坚完成核心故障根因定位与修复",
    "组建跨域应急小组，7x24小时保障客户业务连续性",
    "联合多部门推动复杂问题的端到端解决",
    "团队共建自动化排查能力，大幅缩短MTTR",
    "协同优化系统架构并完成容灾演练",
    "团队牵头制定应急预案并组织实战演练",
    "集中攻关性能瓶颈，整体吞吐提升显著",
    "组团完成大规模数据迁移与一致性校验",
  ];
  let teamCount = 0;
  for (const teamName of teamNames) {
    try {
      const leader = pick(people).properties["姓名"];
      const members = [];
      let guard = 0;
      while (members.length < randInt(2, 4) && guard < 50) {
        guard++;
        const name = pick(people).properties["姓名"];
        if (name !== leader && !members.includes(name)) members.push(name);
      }
      await post("/api/nodes/teamContribution", {
        团队名称: teamName,
        贡献类型: pick(["实施", "发现", "协调", "指导", "支持"]),
        贡献等级: pick(["核心", "关键", "普通"]),
        描述: pick(teamDescs),
        组长: leader,
        组员: members,
        关联攻关单: tickets.length > 0 ? pick(tickets).properties["问题单号"] : undefined,
        周期: pick(periods),
      });
      teamCount++;
    } catch (e) {
      /* skip */
    }
  }
  console.log(`   ✓ ${teamCount} 条团队贡献记录\n`);

  // ═══════════════════════════════════════════
  // 6c. 信息广场 (InfoSquare / 作战态势发布信息) — infoCard
  // ═══════════════════════════════════════════
  console.log("6c. 信息广场 — 发布信息卡片...");
  const infoCards = [
    {
      标题: "P1故障应急响应流程已更新",
      重要程度: "重要",
      信息分类: "通知",
      摘要: "新版应急响应SOP正式生效",
      内容: "## 应急响应流程更新\n\n1. 接到P1告警后5分钟内响应\n2. 15分钟内拉起作战群\n3. 30分钟内给出初步定位\n\n详见知识库。",
    },
    {
      标题: "关于开展月度攻关复盘的公告",
      重要程度: "一般",
      信息分类: "公告",
      摘要: "本月攻关复盘会定于周五下午",
      内容: "请各攻关组长准备本月攻关单复盘材料，重点总结根因与改进项。",
    },
    {
      标题: "ModelArts OOM 问题排查经验",
      重要程度: "普通",
      信息分类: "经验",
      摘要: "cgroup内存限制触发OOM的定位方法",
      内容: "## 排查步骤\n\n- 查看 dmesg OOM killer 日志\n- 确认 cgroup memory.limit\n- 调整 Pod requests/limits",
    },
    {
      标题: "近期数据库主从切换风险预警",
      重要程度: "重要",
      信息分类: "预警",
      摘要: "多个局点出现主从延迟升高",
      内容: "近期 CDB/TDSQL 主从延迟升高，切换有风险，请提前评估并做好预案。",
    },
    {
      标题: "新员工攻关平台使用指引",
      重要程度: "普通",
      信息分类: "通知",
      摘要: "攻关平台快速上手",
      内容: "登录后先在「攻关作战台」查看待处理单，贡献录入在「贡献录入」页。",
    },
    {
      标题: "季度最佳攻关团队评选启动",
      重要程度: "一般",
      信息分类: "公告",
      摘要: "团队荣誉评选开始",
      内容: "本季度最佳攻关团队评选已启动，依据「团队贡献」记录的等级与数量综合评定。",
    },
    {
      标题: "CDN跨域访问失败处置经验",
      重要程度: "普通",
      信息分类: "经验",
      摘要: "CORS与回源配置排查",
      内容: "检查 CORS 响应头与回源 Host 配置，多数跨域失败源于回源 Host 不匹配。",
    },
    {
      标题: "春节保障期变更冻结预警",
      重要程度: "重要",
      信息分类: "预警",
      摘要: "保障期非紧急变更冻结",
      内容: "保障期内非紧急变更一律冻结，紧急变更需走应急审批流程。",
    },
    {
      标题: "技术团队 RACI 责任矩阵",
      重要程度: "重要",
      信息分类: "公告",
      摘要: "基于 RACI 模型的技术团队职责分工矩阵",
      内容: raciMatrix,
    },
  ];
  let infoCount = 0;
  for (const card of infoCards) {
    try {
      await post("/api/nodes/infoCard", { ...card, 发布人: pick(people).properties["姓名"] });
      infoCount++;
    } catch (e) {
      /* skip */
    }
  }
  console.log(`   ✓ ${infoCount} 条信息广场卡片\n`);

  // ═══════════════════════════════════════════
  // 7. 求助中心 (HelpCenter page) — 10条求助
  // ═══════════════════════════════════════════
  console.log("7. 求助中心 — 创建 10 条求助记录...");
  let helpCount = 0;
  const helpCategories = ["环境", "领域专家", "团队协作", "资源"];
  for (let i = 0; i < 10; i++) {
    try {
      await post("/api/help-requests", {
        ticketId: pick(tickets).id,
        requesterName: pick(people).properties["姓名"],
        targetName: pick(people).properties["姓名"],
        targetEmail: `${pick(people).properties["姓名"]}@combat.com`,
        category: pick(helpCategories),
        question: [
          "需要协助分析网络抓包数据，确认是否为DDoS攻击",
          "请提供K8s集群调度的最佳实践建议",
          "需要数据库DBA协助分析慢查询根因",
          "请安全团队协助评估是否需要启动应急响应流程",
          "需要额外的GPU资源用于模型重训练",
          "请帮忙协调测试环境，当前环境被占用",
          "需要算法团队协助优化推荐模型的准确率",
          "请提供容量规划建议，当前资源使用率已超80%",
          "需要前端团队协助排查页面白屏问题",
          "请帮忙联系厂商确认固件升级方案",
        ][i],
      });
      helpCount++;
    } catch (e) {
      /* skip */
    }
  }
  console.log(`   ✓ ${helpCount} 条求助记录\n`);

  // ═══════════════════════════════════════════
  // 8. 问题反馈 (BugReport page) — 2条演示数据
  // 注意：只创建少量已关闭的演示记录，不创建虚假的待处理issue
  // 真实的用户反馈由问题反馈页面提交，不应由 seed 脚本伪造
  // ═══════════════════════════════════════════
  console.log("8. 问题反馈 — 创建演示数据...");
  const demoBugs = [
    { title: "演示：状态筛选功能优化建议", severity: "建议", reporter: "演示用户" },
    { title: "演示：页面加载性能建议", severity: "建议", reporter: "演示用户" },
  ];
  let bugCount = 0;
  for (const bug of demoBugs) {
    try {
      const res = await post("/api/bug-reports", {
        title: bug.title,
        severity: bug.severity,
        description: "此为演示数据，用于展示问题反馈页面的各种状态。可随时删除。",
        reporter: bug.reporter,
        pageUrl: "http://localhost:3001/",
      });
      // 标记为已关闭，避免与真实反馈混淆
      await fetch(`${API}/api/bug-reports/${res.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "已关闭", resolution: "演示数据" }),
      });
      bugCount++;
    } catch (e) {
      /* skip */
    }
  }
  console.log(`   ✓ ${bugCount} 条演示 Bug 报告（已关闭）\n`);

  // ═══════════════════════════════════════════
  // 9. 关系审批 (ProposalsPage) — 需要重复人员触发扫描
  // ═══════════════════════════════════════════
  console.log("9. 关系审批 — 触发候选扫描...");
  try {
    const scanRes = await fetch(`${API}/api/proposals/scan`, { method: "POST", headers });
    if (scanRes.ok) {
      const scanData = await scanRes.json();
      console.log(`   ✓ 扫描完成，新增 ${scanData.created || 0} 条候选关系`);
    }
  } catch (e) {
    console.log(`   - 扫描跳过: ${e.message}`);
  }
  console.log();

  // ═══════════════════════════════════════════
  // 10. 跟催提醒 (RemindersPage) — 触发提醒扫描
  // ═══════════════════════════════════════════
  console.log("10. 跟催提醒 — 触发提醒扫描...");
  try {
    const remindRes = await fetch(`${API}/api/reminders/scan`, { method: "POST", headers });
    if (remindRes.ok) {
      const remindData = await remindRes.json();
      console.log(`   ✓ 扫描完成，新增 ${remindData.created || 0} 条提醒`);
    }
  } catch (e) {
    console.log(`   - 提醒扫描跳过: ${e.message}`);
  }
  console.log();

  // ═══════════════════════════════════════════
  // 11. 求助网络节点 — 为前5张单添加
  // ═══════════════════════════════════════════
  console.log("11. 求助网络 — 为攻关单添加求助节点...");
  const supportCategories = ["环境", "领域专家", "团队协作", "资源"];
  let supportCount = 0;
  for (let i = 0; i < Math.min(5, tickets.length); i++) {
    try {
      await post(`/api/support-nodes/${tickets[i].id}`, {
        category: pick(supportCategories),
        domain: pick(["网络", "安全", "数据库", "中间件", "前端", "算法", "运维"]),
        responsiblePerson: pick(people).properties["姓名"],
        note: "需要协助排查问题",
      });
      supportCount++;
    } catch (e) {
      /* skip */
    }
  }
  console.log(`   ✓ ${supportCount} 个求助节点\n`);

  // ═══════════════════════════════════════════
  // 12. 日报 — 为前3张单创建日报条目
  // ═══════════════════════════════════════════
  console.log("12. 攻关日报 — 创建日报条目...");
  let reportCount = 0;
  for (let i = 0; i < Math.min(3, tickets.length); i++) {
    try {
      await post(`/api/nodes/${tickets[i].id}/daily-reports`, {
        type: pick(["进展通报", "风险通报"]),
        currentProgress: `今日进展：${tickets[i]._meta.title} 当前状态${tickets[i]._meta.status}，正在积极处理中。`,
        nextSteps: "继续跟踪并推进解决",
        createdBy: pick(people).properties["姓名"],
      });
      reportCount++;
    } catch (e) {
      /* skip */
    }
  }
  console.log(`   ✓ ${reportCount} 条日报\n`);

  // ═══════════════════════════════════════════
  // 13. 动态标签 — 为前3张单添加自定义标签
  // ═══════════════════════════════════════════
  console.log("13. 动态标签 — 为攻关单添加标签...");
  let tabCount = 0;
  for (let i = 0; i < Math.min(3, tickets.length); i++) {
    try {
      await post(`/api/tickets/${tickets[i].id}/tabs`, {
        title: "排查笔记",
        tabType: "custom",
        content: `## 排查过程\n\n1. 确认问题现象\n2. 分析日志定位根因\n3. 制定修复方案\n4. 验证修复效果`,
      });
      tabCount++;
      await post(`/api/tickets/${tickets[i].id}/tabs`, {
        title: "关联贡献",
        tabType: "link",
        config: { linkNodeType: "contribution" },
      });
      tabCount++;
    } catch (e) {
      /* skip */
    }
  }
  // 第一个攻关单额外加一个「信息广场」标签，展示完整 Markdown 渲染
  if (tickets.length > 0) {
    try {
      await post(`/api/tickets/${tickets[0].id}/tabs`, {
        title: "信息广场",
        tabType: "custom",
        content: markdownDemo,
      });
      tabCount++;
    } catch (e) {
      /* skip */
    }
  }
  console.log(`   ✓ ${tabCount} 个动态标签\n`);

  // ═══════════════════════════════════════════
  // 14. 关系边 — 创建一些人员-攻关单关系
  // ═══════════════════════════════════════════
  console.log("14. 关联全景 — 创建关系边...");
  let edgeCount = 0;
  for (let i = 0; i < Math.min(10, tickets.length); i++) {
    try {
      const person = pick(people);
      await post("/api/relations/manual", {
        sourceId: person.id,
        targetId: tickets[i].id,
        sourceField: "姓名",
        reason: "负责处理此攻关单",
      });
      edgeCount++;
    } catch (e) {
      /* skip */
    }
  }
  console.log(`   ✓ ${edgeCount} 条关系边\n`);

  // ═══════════════════════════════════════════
  // 15. 数据备份 — 创建备份
  // ═══════════════════════════════════════════
  console.log("15. 数据备份 — 创建备份...");
  try {
    const backupRes = await fetch(`${API}/api/backup`, { method: "POST", headers });
    if (backupRes.ok) console.log("   ✓ 备份已创建");
  } catch (e) {
    console.log(`   - 备份跳过: ${e.message}`);
  }
  console.log();

  // ═══════════════════════════════════════════
  // 16. 全局知识库 (WikiPanel on Dashboard)
  // ═══════════════════════════════════════════
  console.log("16. 全局知识库 — 创建知识库文章...");
  const wikiArticles = [
    {
      title: "应急响应流程",
      content:
        "# 应急响应流程\n\n## 分级标准\n\n| 级别 | 响应时间 | 升级条件 |\n|------|----------|----------|\n| P1 | 5分钟 | 自动升级 |\n| P2 | 15分钟 | 30分钟未响应 |\n| P3 | 1小时 | 4小时未解决 |\n| P4 | 4小时 | 次日未解决 |\n\n## 响应步骤\n\n1. 接到告警，确认故障等级\n2. 拉起作战群，通知相关人\n3. 初步定位，同步进展\n4. 制定修复方案并执行\n5. 验证恢复，复盘总结",
    },
    {
      title: "常用排查命令速查",
      content:
        "# 常用排查命令\n\n## 网络排查\n\n```bash\n# 查看连接状态\nss -s\nnetstat -an | grep ESTABLISHED | wc -l\n\n# 抓包分析\ntcpdump -i eth0 -nn port 443\n```\n\n## 系统排查\n\n```bash\n# 查看负载\ntop -bn1 | head -20\n\n# 磁盘 IO\niostat -xz 1 3\n```",
    },
    {
      title: "客户对接规范",
      content:
        "# 客户对接规范\n\n## 沟通原则\n\n- **及时性**：P1 故障 5 分钟内首次响应\n- **准确性**：进展信息需经技术负责人确认后发出\n- **频率**：每 30 分钟同步一次最新进展\n\n## 模板\n\n### 故障通知\n\n> 【故障通知】XX 客户 XX 服务于 HH:MM 发现异常，当前影响范围 XX，已启动应急响应。",
    },
    {
      title: "版本包发布流程",
      content:
        "# 版本包发布流程\n\n## 发布前检查\n\n- [ ] 所有测试用例通过\n- [ ] 代码 review 完成\n- [ ] 变更影响范围已评估\n- [ ] 回滚方案已准备\n\n## 发布步骤\n\n1. 创建 release 分支\n2. 执行全量测试\n3. 生成变更清单\n4. 灰度发布\n5. 全量发布\n6. 监控验证",
    },
    {
      title: "值班制度与交接",
      content:
        "# 值班制度\n\n## 值班安排\n\n- 工作日：8:00-20:00 主班，20:00-次日 8:00 副班\n- 节假日：7x24 轮值\n\n## 交接清单\n\n1. 当前进行中的故障/任务\n2. 待跟进的客户问题\n3. 已知的系统风险\n4. 上级指示或特殊要求",
    },
  ];
  const existingWiki = await get("/api/wiki?scope=global");
  let wikiCount = 0;
  for (const article of wikiArticles) {
    const dup = existingWiki.find((w) => w.title === article.title);
    if (dup) {
      continue;
    }
    try {
      await post("/api/wiki", { scope: "global", title: article.title, content: article.content });
      wikiCount++;
    } catch (e) {
      /* skip */
    }
  }
  console.log(`   ✓ ${wikiCount} 篇全局知识库文章（已有 ${existingWiki.length} 篇）\n`);

  // ═══════════════════════════════════════════
  // 17. 攻关单局部知识库 (wiki tabs)
  // ═══════════════════════════════════════════
  console.log("17. 攻关单局部知识库 — 为前 3 张单添加 wiki 标签...");
  let wikiTabCount = 0;
  for (let i = 0; i < Math.min(3, tickets.length); i++) {
    try {
      const existingTabs = await get(`/api/tickets/${tickets[i].id}/tabs`);
      const hasWiki = existingTabs.some((t) => t.tabType === "wiki");
      if (hasWiki) continue;
      await post(`/api/tickets/${tickets[i].id}/tabs`, {
        title: "知识库",
        tabType: "wiki",
      });
      wikiTabCount++;
    } catch (e) {
      /* skip */
    }
  }
  if (tickets.length > 0 && wikiTabCount > 0) {
    const existingGlobalWiki = await get("/api/wiki?scope=global");
    const dupArticle = existingGlobalWiki.find((w) => w.title === `${tickets[0].properties["标题"]} 排查记录`);
    if (!dupArticle) {
      try {
        await post("/api/wiki", {
          scope: "ticket",
          scopeId: tickets[0].id,
          title: `${tickets[0].properties["标题"]} 排查记录`,
          content: `# ${tickets[0].properties["标题"]}\n\n## 问题描述\n\n客户 ${tickets[0].properties["客户名称"]} 反馈${tickets[0].properties["标题"]}问题。\n\n## 排查过程\n\n1. 确认问题现象和影响范围\n2. 分析日志定位根因\n3. 制定修复方案\n\n## 修复方案\n\n待补充...`,
        });
        console.log(`   ✓ 为第 1 张单创建了局部 wiki 文章`);
      } catch (e) {
        /* skip */
      }
    }
  }
  console.log(`   ✓ ${wikiTabCount} 个 wiki 标签\n`);

  // ═══════════════════════════════════════════
  // 18. Welink 群消息 mock — 为前 3 张攻关单导入模拟对话
  // ═══════════════════════════════════════════
  console.log("18. Welink 群消息 — 为前 3 张攻关单导入模拟对话...");
  const welinkParticipants = ["张三", "李四", "王五", "赵敏", "刘洋", "马超", "何雪", "朱峰", "林鹏"];
  const welinkScenarios = [
    // 场景 1: 线上问题排查群
    {
      messages: [
        {
          serverSendTime: Date.now() - 3600000 * 5,
          sender: "张三",
          contentType: "TEXT_MSG",
          content: "大家注意，客户反馈线上出现 502 错误，目前影响范围还不确定，我先拉个群",
        },
        {
          serverSendTime: Date.now() - 3600000 * 5 + 30000,
          sender: "李四",
          contentType: "TEXT_MSG",
          content: "收到，我先看下 nginx access log",
        },
        {
          serverSendTime: Date.now() - 3600000 * 5 + 60000,
          sender: "王五",
          contentType: "TEXT_MSG",
          content: "我这边看到 upstream 超时了，后端响应时间从 200ms 飙到 30s",
        },
        {
          serverSendTime: Date.now() - 3600000 * 4.5,
          sender: "李四",
          contentType: "TEXT_MSG",
          content: "找到原因了，数据库连接池满了，大量请求排队。SHOW PROCESSLIST 有 200+ 个连接",
        },
        {
          serverSendTime: Date.now() - 3600000 * 4.5 + 30000,
          sender: "张三",
          contentType: "TEXT_MSG",
          content: "紧急处理：先把 max_connections 调大到 500，然后排查连接泄漏",
        },
        {
          serverSendTime: Date.now() - 3600000 * 4,
          sender: "王五",
          contentType: "TEXT_MSG",
          content: "调完之后连接数降到 80 了，响应时间恢复正常 200ms 左右",
        },
        {
          serverSendTime: Date.now() - 3600000 * 3.5,
          sender: "赵敏",
          contentType: "TEXT_MSG",
          content: "@张三 根因定位了吗？是不是之前上线那个批量任务导致的？",
        },
        {
          serverSendTime: Date.now() - 3600000 * 3.5 + 60000,
          sender: "张三",
          contentType: "TEXT_MSG",
          content: "是的，凌晨 3 点跑的数据同步任务没有释放连接，是 ORM 的 connection leak",
        },
        {
          serverSendTime: Date.now() - 3600000 * 3,
          sender: "刘洋",
          contentType: "TEXT_MSG",
          content: "建议在 ORM 层加 finally 释放 + 连接池监控告警，我这边提个 bug 单",
        },
        {
          serverSendTime: Date.now() - 3600000 * 2.5,
          sender: "张三",
          contentType: "TEXT_MSG",
          content: "同意。先修 hotfix 上线，监控 24h 确认不再泄漏。@马超 你跟进下 hotfix 发布",
        },
        {
          serverSendTime: Date.now() - 3600000 * 2.5 + 30000,
          sender: "马超",
          contentType: "TEXT_MSG",
          content: "收到，已经在准备 hotfix 分支了，预计 1 小时内完成",
        },
        {
          serverSendTime: Date.now() - 3600000 * 1.5,
          sender: "马超",
          contentType: "TEXT_MSG",
          content: "hotfix 已部署到灰度环境，测试通过，准备全量发布",
        },
        {
          serverSendTime: Date.now() - 3600000 * 1,
          sender: "张三",
          contentType: "TEXT_MSG",
          content: "全量发布完成，监控指标正常。连接数稳定在 50 左右。问题已解决",
        },
        {
          serverSendTime: Date.now() - 1800000,
          sender: "何雪",
          contentType: "TEXT_MSG",
          content: "我来整理下复盘报告，明天早上发出",
        },
      ],
    },
    // 场景 2: 版本发布群
    {
      messages: [
        {
          serverSendTime: Date.now() - 7200000 * 8,
          sender: "朱峰",
          contentType: "TEXT_MSG",
          content: "v2.3.10 发版计划：今天下午 3 点开始，预计 4 点完成。各模块负责人确认下自己负责的部分",
        },
        {
          serverSendTime: Date.now() - 7200000 * 8 + 120000,
          sender: "林鹏",
          contentType: "TEXT_MSG",
          content: "后端 API 变更已全部完成，单元测试 790/790 通过，可以发",
        },
        {
          serverSendTime: Date.now() - 7200000 * 7,
          sender: "赵敏",
          contentType: "TEXT_MSG",
          content: "前端构建完成，bundle size 3.5MB，首次加载 1.2s，可以接受",
        },
        {
          serverSendTime: Date.now() - 7200000 * 6,
          sender: "朱峰",
          contentType: "TEXT_MSG",
          content: "开始灰度发布，先切 10% 流量",
        },
        {
          serverSendTime: Date.now() - 7200000 * 5,
          sender: "刘洋",
          contentType: "TEXT_MSG",
          content: "灰度监控正常，错误率 0.01%，P99 延迟 200ms，和之前持平",
        },
        {
          serverSendTime: Date.now() - 7200000 * 4,
          sender: "朱峰",
          contentType: "TEXT_MSG",
          content: "全量发布完成。所有指标正常，无告警",
        },
        {
          serverSendTime: Date.now() - 7200000 * 3,
          sender: "何雪",
          contentType: "TEXT_MSG",
          content: "发版完成通知已发出。新功能：知识库 Wiki + API 自动文档 + 前端代码拆分",
        },
      ],
    },
    // 场景 3: 客户问题跟进群
    {
      messages: [
        {
          serverSendTime: Date.now() - 86400000,
          sender: "张三",
          contentType: "TEXT_MSG",
          content: "客户反馈接口响应变慢，从 200ms 变到 2s，大家关注下",
        },
        {
          serverSendTime: Date.now() - 86400000 + 300000,
          sender: "李四",
          contentType: "TEXT_MSG",
          content: "看了 APM 追踪，发现是 Redis 缓存命中率从 95% 掉到 30%",
        },
        {
          serverSendTime: Date.now() - 86400000 + 600000,
          sender: "王五",
          contentType: "TEXT_MSG",
          content: "Redis 内存快满了，大量 key 被 LRU 淘汰。当前 used_memory 7.8G / maxmemory 8G",
        },
        {
          serverSendTime: Date.now() - 86400000 + 900000,
          sender: "张三",
          contentType: "TEXT_MSG",
          content: "紧急方案：扩大 Redis 到 16G。长期方案：优化缓存策略，减少不必要的缓存",
        },
        {
          serverSendTime: Date.now() - 86400000 + 1800000,
          sender: "马超",
          contentType: "TEXT_MSG",
          content: "Redis 已扩容到 16G，缓存命中率恢复到 92%",
        },
        {
          serverSendTime: Date.now() - 86400000 + 3600000,
          sender: "赵敏",
          contentType: "TEXT_MSG",
          content: "接口响应时间恢复正常，客户确认不再慢了",
        },
        {
          serverSendTime: Date.now() - 43200000,
          sender: "刘洋",
          contentType: "TEXT_MSG",
          content: "后续优化方案：1) 缓存 key 加 TTL 2) 热点数据用本地缓存 3) 定期清理无效缓存",
        },
        {
          serverSendTime: Date.now() - 21600000,
          sender: "张三",
          contentType: "TEXT_MSG",
          content: "优化方案已评审通过，安排到下个迭代执行",
        },
      ],
    },
  ];
  let welinkCount = 0;
  for (let i = 0; i < Math.min(3, tickets.length); i++) {
    const ticket = tickets[i];
    const scenario = welinkScenarios[i];
    if (!scenario) continue;
    const messages = scenario.messages.map((m, idx) => ({
      messageId: `demo-wl-${ticket.id.slice(0, 8)}-${idx}`,
      serverSendTime: m.serverSendTime,
      sender: m.sender,
      contentType: m.contentType,
      content: m.content,
    }));
    try {
      const res = await post(`/tickets/${ticket.id}/welink-messages`, { messages });
      if (res.inserted || res.updated) {
        welinkCount++;
        console.log(`   ✓ 攻关单「${ticket.properties["标题"]}」导入 ${messages.length} 条 Welink 消息`);
      }
    } catch (e) {
      console.log(`   - 攻关单 ${i + 1} Welink 导入跳过: ${e.message}`);
    }
  }
  console.log(`   ✓ ${welinkCount} 个攻关单已导入 Welink 消息\n`);

  // ═══════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════
  console.log("19. 数据备份 — 创建备份...");
  try {
    const backupRes = await fetch(`${API}/api/backup`, { method: "POST", headers });
    if (backupRes.ok) console.log("   ✓ 备份已创建");
  } catch (e) {
    console.log(`   - 备份跳过: ${e.message}`);
  }
  console.log();

  // ═══════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════
  console.log("══════════════════════════════════════════");
  console.log("  演示数据填充完成！覆盖以下功能页面：");
  console.log("  ────────────────────────────────────────");
  console.log("  /             作战态势 Dashboard");
  console.log("  /attack       攻关作战台 (30张)");
  console.log("  /attack/:id   攻关详情 (进展/求助网络/日报/动态标签)");
  console.log("  /people       全员名单 (20+人, 含重复)");
  console.log("  /contributions 贡献录入 (40条, 含团队贡献)");
  console.log("  /honor        荣誉殿堂排行榜 (含团队贡献)");
  console.log("  /honor/:name  个人荣誉详情");
  console.log("  /help         求助中心 (10条)");
  console.log("  /daily-report 攻关日报");
  console.log("  /proposals    关系审批 (重复人触发)");
  console.log("  /reminders    跟催提醒");
  console.log("  /bug-report   问题反馈 (演示数据, 已关闭)");
  console.log("  /merge        人员合并 (2对重复人)");
  console.log("  /search       全局搜索");
  console.log("  /related/:t/:id 关联全景");
  console.log("  /audit        审计日志");
  console.log("  /op-log       操作追踪");
  console.log("  /config       配置中心");
  console.log("  /schema       表结构管理");
  console.log("  /import       数据导入导出");
  console.log("  /email        邮件设置");
  console.log("  /users        用户管理");
  console.log("  /backup       数据库备份恢复");
  console.log("  Welink消息    前3张攻关单模拟群聊对话");
  console.log("  /login        登录页面");
  console.log("══════════════════════════════════════════");
  console.log(`\n  访问: ${API.replace("/api", "")}`);
  console.log("  账号: admin / admin123\n");
}

seed().catch((e) => {
  console.error("填充失败:", e.message);
  process.exit(1);
});
