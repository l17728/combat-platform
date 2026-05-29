#!/usr/bin/env node
// demo-seed — 全功能演示数据填充，覆盖所有页面和功能
// 用法: node scripts/mock-data/demo-seed.mjs [--api http://localhost:3001]
// 前提: 后端 API 正在运行，数据库为空或可覆盖

const API = process.env.COMBAT_API || process.argv.includes('--api')
  ? process.argv[process.argv.indexOf('--api') + 1]
  : 'http://localhost:3001';

let headers = { 'Content-Type': 'application/json' };

async function login() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  if (!res.ok) throw new Error(`登录失败: ${res.status}`);
  const data = await res.json();
  headers['Authorization'] = `Bearer ${data.token}`;
  headers['X-Role'] = data.user.role;
  console.log(`   已登录 (${data.user.displayName})\n`);
}

async function post(path, body) {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function put(path, body) {
  const res = await fetch(`${API}${path}`, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`PUT ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function get(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) return [];
  return res.json();
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function seed() {
  console.log(`\n🚀 全功能演示数据填充 (API: ${API})\n`);
  await login();

  // ═══════════════════════════════════════════
  // 1. 配置中心 (ConfigCenter page)
  // ═══════════════════════════════════════════
  console.log('1. 配置中心 — 填充下拉选项...');
  const settings = {
    '状态': { values: ['待响应', '处理中', '进行中', '已解决', '已关闭'], label: '攻关单状态' },
    '事件级别': { values: ['P1', 'P2', 'P3', 'P4', 'P4A', 'P4B'], label: '事件级别' },
    '贡献类型': { values: ['实施', '发现', '协调', '指导', '支持'], label: '贡献类型' },
    '贡献等级': { values: ['核心', '关键', '普通'], label: '贡献等级' },
    '求助分类': { values: ['环境', '领域专家', '团队协作', '资源'], label: '求助网络分类' },
    '求助状态': { values: ['待确认', '支持中', '已完成', '已撤销'], label: '求助节点状态' },
    '求助中心状态': { values: ['待回复', '已回复'], label: '求助中心筛选状态' },
    '日报类型': { values: ['进展通报', '风险通报'], label: '攻关日报类型' },
  };
  for (const [key, val] of Object.entries(settings)) {
    await put(`/api/settings/${encodeURIComponent(key)}`, val);
  }
  console.log(`   ✓ ${Object.keys(settings).length} 个配置项\n`);

  // ═══════════════════════════════════════════
  // 2. 用户管理 (UserManagement page)
  // ═══════════════════════════════════════════
  console.log('2. 用户管理 — 创建演示用户...');
  const users = [
    { username: 'admin', password: 'admin123', displayName: '系统管理员', role: 'admin' },
    { username: 'zhangsan', password: '123456', displayName: '张三', role: 'leader' },
    { username: 'lisi', password: '123456', displayName: '李四', role: 'normal' },
    { username: 'wangwu', password: '123456', displayName: '王五', role: 'normal' },
  ];
  for (const u of users) {
    try { await post('/api/auth/register', u); console.log(`   ✓ ${u.displayName} (${u.role})`); }
    catch (e) { if (e.message.includes('409') || e.message.includes('已存在')) console.log(`   - ${u.displayName} 已存在`); else console.warn(`   ✗ ${u.displayName}: ${e.message}`); }
  }
  console.log();

  // ═══════════════════════════════════════════
  // 3. 全员名单 (PeopleList page) — 20人
  // ═══════════════════════════════════════════
  console.log('3. 全员名单 — 创建 20 名成员...');
  const peopleData = [
    { 姓名: '张三', 工号: 'EMP001', 邮箱: 'zhangsan@combat.com', 部门: '网络部', 角色: '组长' },
    { 姓名: '李四', 工号: 'EMP002', 邮箱: 'lisi@combat.com', 部门: '网络部', 角色: '高级工程师' },
    { 姓名: '王五', 工号: 'EMP003', 邮箱: 'wangwu@combat.com', 部门: '平台部', 角色: '工程师' },
    { 姓名: '赵敏', 工号: 'EMP004', 邮箱: 'zhaomin@combat.com', 部门: '安全部', 角色: '安全专家' },
    { 姓名: '陈静', 工号: 'EMP005', 邮箱: 'chenjing@combat.com', 部门: '数据部', 角色: '数据分析师' },
    { 姓名: '杨磊', 工号: 'EMP006', 邮箱: 'yanglei@combat.com', 部门: '运维部', 角色: '运维工程师' },
    { 姓名: '黄浩', 工号: 'EMP007', 邮箱: 'huanghao@combat.com', 部门: '研发部', 角色: '架构师' },
    { 姓名: '周琳', 工号: 'EMP008', 邮箱: 'zhoulin@combat.com', 部门: '平台部', 角色: '项目经理' },
    { 姓名: '吴涛', 工号: 'EMP009', 邮箱: 'wutao@combat.com', 部门: '网络部', 角色: '网络工程师' },
    { 姓名: '徐明', 工号: 'EMP010', 邮箱: 'xuming@combat.com', 部门: '安全部', 角色: '渗透测试工程师' },
    { 姓名: '孙丽', 工号: 'EMP011', 邮箱: 'sunli@combat.com', 部门: '数据部', 角色: 'DBA' },
    { 姓名: '马超', 工号: 'EMP012', 邮箱: 'machao@combat.com', 部门: '研发部', 角色: '前端工程师' },
    { 姓名: '朱峰', 工号: 'EMP013', 邮箱: 'zhufeng@combat.com', 部门: '运维部', 角色: 'SRE' },
    { 姓名: '胡婷', 工号: 'EMP014', 邮箱: 'huting@combat.com', 部门: '平台部', 角色: '测试工程师' },
    { 姓名: '郭鑫', 工号: 'EMP015', 邮箱: 'guoxin@combat.com', 部门: '网络部', 角色: '网络工程师' },
    { 姓名: '林鹏', 工号: 'EMP016', 邮箱: 'linpeng@combat.com', 部门: '安全部', 角色: '安全工程师' },
    { 姓名: '何雪', 工号: 'EMP017', 邮箱: 'hexue@combat.com', 部门: '研发部', 角色: '后端工程师' },
    { 姓名: '高飞', 工号: 'EMP018', 邮箱: 'gaofei@combat.com', 部门: '数据部', 角色: '算法工程师' },
    { 姓名: '罗军', 工号: 'EMP019', 邮箱: 'luojun@combat.com', 部门: '运维部', 角色: '系统工程师' },
    { 姓名: '刘洋', 工号: 'EMP020', 邮箱: 'liuyang@combat.com', 部门: '平台部', 角色: '技术总监' },
    // 重复姓名用于人员合并和关系审批演示
    { 姓名: '张三', 工号: 'EXT001', 邮箱: 'zhangsan_ext@partner.com', 部门: '外部团队', 角色: '外部专家' },
    { 姓名: '赵敏', 工号: 'EXT002', 邮箱: 'zhaomin_ext@partner.com', 部门: '外部协作', 角色: '顾问' },
  ];
  const people = [];
  for (const p of peopleData) {
    try { people.push(await post('/api/nodes/person', p)); } catch (e) { /* skip */ }
  }
  console.log(`   ✓ ${people.length} 名成员（含 2 对重复姓名用于合并演示）\n`);

  // ═══════════════════════════════════════════
  // 4. 攻关作战台 (AttackList + AttackDetail) — 30张单子
  // ═══════════════════════════════════════════
  console.log('4. 攻关作战台 — 创建 30 张攻关单（覆盖所有状态和级别）...');
  const ticketTitles = [
    { title: '华为云MaaS服务503故障', customer: '华为云', level: 'P1', status: '待响应' },
    { title: '阿里云OSS上传超时问题', customer: '阿里云', level: 'P1', status: '处理中' },
    { title: '腾讯云CDB主从切换失败', customer: '腾讯云', level: 'P1', status: '进行中' },
    { title: '中国移动5G核心网信令异常', customer: '中国移动', level: 'P1', status: '已解决' },
    { title: '国家电网调度系统响应延迟', customer: '国家电网', level: 'P1', status: '已关闭' },
    { title: '工商银行手机银行登录超时', customer: '工商银行', level: 'P2', status: '待响应' },
    { title: '华为云ECS实例创建失败', customer: '华为云', level: 'P2', status: '处理中' },
    { title: '阿里云SLB健康检查异常', customer: '阿里云', level: 'P2', status: '进行中' },
    { title: '腾讯云TRTCC音视频卡顿', customer: '腾讯云', level: 'P2', status: '已解决' },
    { title: '中国移动短信网关拥塞', customer: '中国移动', level: 'P2', status: '已关闭' },
    { title: '华为云ModelArts训练任务OOM', customer: '华为云', level: 'P3', status: '待响应' },
    { title: '阿里云DataWorks数据倾斜', customer: '阿里云', level: 'P3', status: '处理中' },
    { title: '腾讯云CKV集群脑裂', customer: '腾讯云', level: 'P3', status: '进行中' },
    { title: '国家电网边缘网关断连', customer: '国家电网', level: 'P3', status: '已解决' },
    { title: '工商银行风控模型误报率高', customer: '工商银行', level: 'P3', status: '已关闭' },
    { title: '华为云CES监控数据丢失', customer: '华为云', level: 'P4', status: '待响应' },
    { title: '阿里云RAM权限策略失效', customer: '阿里云', level: 'P4', status: '处理中' },
    { title: '腾讯云API网关限流误触', customer: '腾讯云', level: 'P4', status: '已解决' },
    { title: '中国移动DNS解析延迟升高', customer: '中国移动', level: 'P4', status: '已关闭' },
    { title: '华为云DCS缓存穿透', customer: '华为云', level: 'P4A', status: '待响应' },
    { title: '阿里云NAS文件系统只读', customer: '阿里云', level: 'P4A', status: '处理中' },
    { title: '腾讯云TDSQL慢查询暴增', customer: '腾讯云', level: 'P4A', status: '已解决' },
    { title: '国家电网光伏预测精度下降', customer: '国家电网', level: 'P4B', status: '待响应' },
    { title: '工商银行对账系统超时', customer: '工商银行', level: 'P4B', status: '处理中' },
    { title: '华为云DIS数据积压', customer: '华为云', level: 'P4B', status: '已关闭' },
    { title: '阿里云FC冷启动耗时长', customer: '阿里云', level: 'P3', status: '待响应' },
    { title: '腾讯云COS跨域访问失败', customer: '腾讯云', level: 'P4', status: '处理中' },
    { title: '中国移动物联网设备离线', customer: '中国移动', level: 'P2', status: '进行中' },
    { title: '国家电网SCADA数据延迟', customer: '国家电网', level: 'P3', status: '处理中' },
    { title: '工商银行支付链路偶发504', customer: '工商银行', level: 'P1', status: '进行中' },
  ];

  const tickets = [];
  for (let i = 0; i < ticketTitles.length; i++) {
    const t = ticketTitles[i];
    const handler = pick(people).properties['姓名'];
    const leader = pick(people).properties['姓名'];
    try {
      const ticket = await post('/api/nodes/attackTicket', {
        标题: t.title,
        状态: t.status,
        事件级别: t.level,
        客户名称: t.customer,
        问题单号: `PB2026${String(randInt(100000, 999999))}`,
        事件单号: `EV2026${String(randInt(100000, 999999))}`,
        当前处理人: handler,
        攻关组长: leader,
        攻关申请人: pick(people).properties['姓名'],
        影响及现存风险: `${t.customer}${t.title}影响范围较大，需紧急处理。当前已影响${randInt(2, 10)}个租户的业务运行，SLA指标可能不达标。`,
      });
      tickets.push({ ...ticket, _meta: t });
    } catch (e) { console.warn(`   ✗ ${t.title}: ${e.message}`); }
  }
  console.log(`   ✓ ${tickets.length} 张攻关单\n`);

  // ═══════════════════════════════════════════
  // 5. 进展同步 — 为每张单子追加2-5条进展
  // ═══════════════════════════════════════════
  console.log('5. 进展同步 — 追加进展记录...');
  const progressTemplates = [
    '已收到客户反馈，正在确认问题范围和影响面',
    '初步排查：确认是后端服务超时导致，已定位到相关日志',
    '已联系服务端团队排查，预计2小时内给出修复方案',
    '修复方案已确定：调整连接池参数并扩容实例，正在执行',
    '已完成修复，所有租户恢复正常，持续监控中',
    '根因分析：连接池耗尽导致请求排队，触发级联超时',
    '已协调DBA团队排查数据库慢查询，发现3条慢SQL',
    '正在与客户同步最新进展，客户表示理解并希望尽快解决',
    '已完成灰度验证，准备全量发布',
    '全量发布完成，系统运行稳定，各项指标正常',
  ];
  let progressCount = 0;
  for (const ticket of tickets) {
    const count = randInt(2, 5);
    for (let j = 0; j < count; j++) {
      try {
        await post(`/api/nodes/${ticket.id}/progress`, {
          content: progressTemplates[j % progressTemplates.length],
          statusSnapshot: ticket._meta.status,
          actor: pick(people).properties['姓名'],
        });
        progressCount++;
      } catch (e) { /* skip */ }
    }
  }
  console.log(`   ✓ ${progressCount} 条进展记录\n`);

  // ═══════════════════════════════════════════
  // 6. 贡献录入 (Contributions page) — 40条
  // ═══════════════════════════════════════════
  console.log('6. 贡献录入 — 创建 40 条贡献记录...');
  const contribDescs = [
    '主导完成根因分析并制定修复方案',
    '协调跨部门资源推动问题解决',
    '第一时间发现异常并触发告警',
    '编写自动化脚本加速排查过程',
    '指导新人完成测试验证工作',
    '提供领域专业知识支持决策',
    '优化监控系统提升故障发现速度',
    '设计并实施容灾切换方案',
    '完成客户沟通和期望管理',
    '支持7x24小时值班保障',
  ];
  const periods = ['2025-Q3', '2025-Q4', '2026-Q1', '2026-Q2'];
  let contribCount = 0;
  const contribHeaders = { ...headers, 'X-Role': 'leader' };
  for (let i = 0; i < 40; i++) {
    try {
      const person = pick(people);
      const res = await fetch(`${API}/api/nodes/contribution`, {
        method: 'POST', headers: contribHeaders, body: JSON.stringify({
          贡献人: person.properties['姓名'],
          贡献类型: pick(['实施', '发现', '协调', '指导', '支持']),
          贡献等级: pick(['核心', '关键', '普通']),
          描述: pick(contribDescs),
          周期: pick(periods),
          关联攻关单: tickets.length > 0 ? pick(tickets).properties['问题单号'] : undefined,
        }),
      });
      if (res.ok) contribCount++;
    } catch (e) { /* skip */ }
  }
  console.log(`   ✓ ${contribCount} 条贡献记录\n`);

  // ═══════════════════════════════════════════
  // 6b. 团队贡献 (teamContribution) — ~10条
  // ═══════════════════════════════════════════
  console.log('6b. 团队贡献 — 创建团队贡献记录...');
  const teamNames = ['攻坚突击队', '护航保障队', '数据攻坚组', '网络应急队', '安全防护组', '平台护航组', '算法优化组', '运维保障队', '跨域协同组', '客户支撑队'];
  const teamDescs = [
    '团队协同攻坚完成核心故障根因定位与修复',
    '组建跨域应急小组，7x24小时保障客户业务连续性',
    '联合多部门推动复杂问题的端到端解决',
    '团队共建自动化排查能力，大幅缩短MTTR',
    '协同优化系统架构并完成容灾演练',
    '团队牵头制定应急预案并组织实战演练',
    '集中攻关性能瓶颈，整体吞吐提升显著',
    '组团完成大规模数据迁移与一致性校验',
  ];
  let teamCount = 0;
  for (const teamName of teamNames) {
    try {
      const leader = pick(people).properties['姓名'];
      const members = [];
      let guard = 0;
      while (members.length < randInt(2, 4) && guard < 50) {
        guard++;
        const name = pick(people).properties['姓名'];
        if (name !== leader && !members.includes(name)) members.push(name);
      }
      await post('/api/nodes/teamContribution', {
        团队名称: teamName,
        贡献类型: pick(['实施', '发现', '协调', '指导', '支持']),
        贡献等级: pick(['核心', '关键', '普通']),
        描述: pick(teamDescs),
        组长: leader,
        组员: members,
        关联攻关单: tickets.length > 0 ? pick(tickets).properties['问题单号'] : undefined,
        周期: pick(periods),
      });
      teamCount++;
    } catch (e) { /* skip */ }
  }
  console.log(`   ✓ ${teamCount} 条团队贡献记录\n`);

  // ═══════════════════════════════════════════
  // 7. 求助中心 (HelpCenter page) — 10条求助
  // ═══════════════════════════════════════════
  console.log('7. 求助中心 — 创建 10 条求助记录...');
  let helpCount = 0;
  const helpCategories = ['环境', '领域专家', '团队协作', '资源'];
  for (let i = 0; i < 10; i++) {
    try {
      await post('/api/help-requests', {
        ticketId: pick(tickets).id,
        requesterName: pick(people).properties['姓名'],
        targetName: pick(people).properties['姓名'],
        targetEmail: `${pick(people).properties['姓名']}@combat.com`,
        category: pick(helpCategories),
        question: [
          '需要协助分析网络抓包数据，确认是否为DDoS攻击',
          '请提供K8s集群调度的最佳实践建议',
          '需要数据库DBA协助分析慢查询根因',
          '请安全团队协助评估是否需要启动应急响应流程',
          '需要额外的GPU资源用于模型重训练',
          '请帮忙协调测试环境，当前环境被占用',
          '需要算法团队协助优化推荐模型的准确率',
          '请提供容量规划建议，当前资源使用率已超80%',
          '需要前端团队协助排查页面白屏问题',
          '请帮忙联系厂商确认固件升级方案',
        ][i],
      });
      helpCount++;
    } catch (e) { /* skip */ }
  }
  console.log(`   ✓ ${helpCount} 条求助记录\n`);

  // ═══════════════════════════════════════════
  // 8. 问题反馈 (BugReport page) — 2条演示数据
  // 注意：只创建少量已关闭的演示记录，不创建虚假的待处理issue
  // 真实的用户反馈由问题反馈页面提交，不应由 seed 脚本伪造
  // ═══════════════════════════════════════════
  console.log('8. 问题反馈 — 创建演示数据...');
  const demoBugs = [
    { title: '演示：状态筛选功能优化建议', severity: '建议', reporter: '演示用户' },
    { title: '演示：页面加载性能建议', severity: '建议', reporter: '演示用户' },
  ];
  let bugCount = 0;
  for (const bug of demoBugs) {
    try {
      const res = await post('/api/bug-reports', {
        title: bug.title,
        severity: bug.severity,
        description: '此为演示数据，用于展示问题反馈页面的各种状态。可随时删除。',
        reporter: bug.reporter,
        pageUrl: 'http://localhost:3001/',
      });
      // 标记为已关闭，避免与真实反馈混淆
      await fetch(`${API}/api/bug-reports/${res.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: '已关闭', resolution: '演示数据' }) });
      bugCount++;
    } catch (e) { /* skip */ }
  }
  console.log(`   ✓ ${bugCount} 条演示 Bug 报告（已关闭）\n`);

  // ═══════════════════════════════════════════
  // 9. 关系审批 (ProposalsPage) — 需要重复人员触发扫描
  // ═══════════════════════════════════════════
  console.log('9. 关系审批 — 触发候选扫描...');
  try {
    const scanRes = await fetch(`${API}/api/proposals/scan`, { method: 'POST', headers });
    if (scanRes.ok) {
      const scanData = await scanRes.json();
      console.log(`   ✓ 扫描完成，新增 ${scanData.created || 0} 条候选关系`);
    }
  } catch (e) { console.log(`   - 扫描跳过: ${e.message}`); }
  console.log();

  // ═══════════════════════════════════════════
  // 10. 跟催提醒 (RemindersPage) — 触发提醒扫描
  // ═══════════════════════════════════════════
  console.log('10. 跟催提醒 — 触发提醒扫描...');
  try {
    const remindRes = await fetch(`${API}/api/reminders/scan`, { method: 'POST', headers });
    if (remindRes.ok) {
      const remindData = await remindRes.json();
      console.log(`   ✓ 扫描完成，新增 ${remindData.created || 0} 条提醒`);
    }
  } catch (e) { console.log(`   - 提醒扫描跳过: ${e.message}`); }
  console.log();

  // ═══════════════════════════════════════════
  // 11. 求助网络节点 — 为前5张单添加
  // ═══════════════════════════════════════════
  console.log('11. 求助网络 — 为攻关单添加求助节点...');
  const supportCategories = ['环境', '领域专家', '团队协作', '资源'];
  let supportCount = 0;
  for (let i = 0; i < Math.min(5, tickets.length); i++) {
    try {
      await post(`/api/support-nodes/${tickets[i].id}`, {
        category: pick(supportCategories),
        domain: pick(['网络', '安全', '数据库', '中间件', '前端', '算法', '运维']),
        responsiblePerson: pick(people).properties['姓名'],
        note: '需要协助排查问题',
      });
      supportCount++;
    } catch (e) { /* skip */ }
  }
  console.log(`   ✓ ${supportCount} 个求助节点\n`);

  // ═══════════════════════════════════════════
  // 12. 日报 — 为前3张单创建日报条目
  // ═══════════════════════════════════════════
  console.log('12. 攻关日报 — 创建日报条目...');
  let reportCount = 0;
  for (let i = 0; i < Math.min(3, tickets.length); i++) {
    try {
      await post(`/api/nodes/${tickets[i].id}/daily-reports`, {
        type: pick(['进展通报', '风险通报']),
        currentProgress: `今日进展：${tickets[i]._meta.title} 当前状态${tickets[i]._meta.status}，正在积极处理中。`,
        nextSteps: '继续跟踪并推进解决',
        createdBy: pick(people).properties['姓名'],
      });
      reportCount++;
    } catch (e) { /* skip */ }
  }
  console.log(`   ✓ ${reportCount} 条日报\n`);

  // ═══════════════════════════════════════════
  // 13. 动态标签 — 为前3张单添加自定义标签
  // ═══════════════════════════════════════════
  console.log('13. 动态标签 — 为攻关单添加标签...');
  let tabCount = 0;
  for (let i = 0; i < Math.min(3, tickets.length); i++) {
    try {
      await post(`/api/tickets/${tickets[i].id}/tabs`, {
        title: '排查笔记',
        tabType: 'custom',
        content: `## 排查过程\n\n1. 确认问题现象\n2. 分析日志定位根因\n3. 制定修复方案\n4. 验证修复效果`,
      });
      tabCount++;
      await post(`/api/tickets/${tickets[i].id}/tabs`, {
        title: '关联贡献',
        tabType: 'link',
        config: { linkNodeType: 'contribution' },
      });
      tabCount++;
    } catch (e) { /* skip */ }
  }
  console.log(`   ✓ ${tabCount} 个动态标签\n`);

  // ═══════════════════════════════════════════
  // 14. 关系边 — 创建一些人员-攻关单关系
  // ═══════════════════════════════════════════
  console.log('14. 关联全景 — 创建关系边...');
  let edgeCount = 0;
  for (let i = 0; i < Math.min(10, tickets.length); i++) {
    try {
      const person = pick(people);
      await post('/api/relations/manual', {
        sourceId: person.id,
        targetId: tickets[i].id,
        sourceField: '姓名',
        reason: '负责处理此攻关单',
      });
      edgeCount++;
    } catch (e) { /* skip */ }
  }
  console.log(`   ✓ ${edgeCount} 条关系边\n`);

  // ═══════════════════════════════════════════
  // 15. 备份 — 创建一个备份
  // ═══════════════════════════════════════════
  console.log('15. 数据备份 — 创建备份...');
  try {
    const backupRes = await fetch(`${API}/api/backup`, { method: 'POST', headers });
    if (backupRes.ok) console.log('   ✓ 备份已创建');
  } catch (e) { console.log(`   - 备份跳过: ${e.message}`); }
  console.log();

  // ═══════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════
  console.log('══════════════════════════════════════════');
  console.log('  演示数据填充完成！覆盖以下功能页面：');
  console.log('  ────────────────────────────────────────');
  console.log('  /             作战态势 Dashboard');
  console.log('  /attack       攻关作战台 (30张)');
  console.log('  /attack/:id   攻关详情 (进展/求助网络/日报/动态标签)');
  console.log('  /people       全员名单 (20+人, 含重复)');
  console.log('  /contributions 贡献录入 (40条, 含团队贡献)');
  console.log('  /honor        荣誉殿堂排行榜 (含团队贡献)');
  console.log('  /honor/:name  个人荣誉详情');
  console.log('  /help         求助中心 (10条)');
  console.log('  /daily-report 攻关日报');
  console.log('  /proposals    关系审批 (重复人触发)');
  console.log('  /reminders    跟催提醒');
  console.log('  /bug-report   问题反馈 (演示数据, 已关闭)');
  console.log('  /merge        人员合并 (2对重复人)');
  console.log('  /search       全局搜索');
  console.log('  /related/:t/:id 关联全景');
  console.log('  /audit        审计日志');
  console.log('  /op-log       操作追踪');
  console.log('  /config       配置中心');
  console.log('  /schema       表结构管理');
  console.log('  /import       数据导入导出');
  console.log('  /email        邮件设置');
  console.log('  /users        用户管理');
  console.log('  /backup       数据库备份恢复');
  console.log('  /login        登录页面');
  console.log('══════════════════════════════════════════');
  console.log(`\n  访问: ${API.replace('/api', '')}`);
  console.log('  账号: admin / admin123\n');
}

seed().catch(e => { console.error('填充失败:', e.message); process.exit(1); });
