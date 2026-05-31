// §v2.7: systemd drop-in conflict detector + cleanup planner
//
// 背景:v2.6 现网部署存在多个 /etc/systemd/system/combat-v2.service.d/*.conf
// 同时设置同一 env key(如 HERMES_MODEL),systemd 合并时按字典序加载,后者覆盖前者
// 但运维很难察觉,改值后老 drop-in 偷偷"复活"。
//
// 本模块导出纯函数,接收 drop-in 文件名+内容 list,返回 cleanup plan:
//   {
//     conflicts: [{key, files: [...]}],   // 同 env key 出现在多个文件
//     toBackup: [文件名...],              // 计划备份(改 .bak)的旧 drop-in
//     toKeep: [文件名...],                // 保留的权威 drop-in
//     log: '可读的 cleanup 摘要'
//   }
//
// 规则(可调):
//   - hermes-llm.conf 是 v2.7 起的权威 drop-in,最优先保留
//   - 其余 .conf 文件中如果与 hermes-llm.conf 冲突,改名加 .bak 备份后从加载链移除
//   - 不冲突的 drop-in 一律保留
//
// 单测:apps/backend/test/dropin-cleanup.unit.test.ts

/**
 * 解析单个 drop-in conf 文件的 Environment= 行,返回 {KEY: VAL} map。
 * systemd Environment= 语法:
 *   Environment=KEY=VAL                      (单条)
 *   Environment="KEY1=VAL1" "KEY2=VAL2"      (多条带引号)
 *   Environment=KEY=VAL1 KEY2=VAL2           (多条无引号 — 但用空格分隔的 VAL 不可靠,这里只取 = 左边)
 * 我们只关心 KEY 用来检测覆盖冲突;VAL 不解析。
 */
export function parseEnvironmentKeys(content) {
  const keys = new Set();
  if (typeof content !== "string") return keys;
  const lines = content.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (!line.toLowerCase().startsWith("environment=")) continue;
    const rhs = line.slice("environment=".length);
    // 匹配带引号 / 不带引号的 KEY=
    const re = /"?([A-Za-z_][A-Za-z0-9_]*)\s*=/g;
    let m;
    while ((m = re.exec(rhs)) !== null) {
      keys.add(m[1]);
    }
  }
  return keys;
}

/**
 * 给定多个 drop-in 文件(已排序时为 systemd 实际加载顺序),
 * 返回每个 env key 对应的 source files。
 * @param {Array<{name:string, content:string}>} files
 * @returns {Map<string, string[]>}
 */
export function buildKeyOwnership(files) {
  const map = new Map();
  for (const f of files) {
    const keys = parseEnvironmentKeys(f.content);
    for (const k of keys) {
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(f.name);
    }
  }
  return map;
}

/**
 * 计算 cleanup plan。
 * @param {Array<{name:string, content:string}>} files - 已收集的 drop-in 文件
 * @param {Object} opts
 * @param {string[]} [opts.authoritative=['hermes-llm.conf']] - 权威 drop-in 文件名(优先级最高)
 * @returns {{conflicts: Array, toBackup: string[], toKeep: string[], log: string}}
 */
export function planDropInCleanup(files, opts = {}) {
  const authoritative = opts.authoritative ?? ["hermes-llm.conf"];
  const ownership = buildKeyOwnership(files);
  const conflicts = [];
  const toBackup = new Set();
  const toKeep = new Set();

  for (const [key, owners] of ownership) {
    if (owners.length <= 1) continue;
    conflicts.push({ key, files: [...owners] });
    // 决策:owners 中如果含权威文件,其余非权威列入 backup;
    // 若都不是权威,保留字典序最后一个(systemd 实际生效那个),其余 backup
    const authOwner = owners.find((n) => authoritative.includes(n));
    let winner;
    if (authOwner) {
      winner = authOwner;
    } else {
      const sorted = [...owners].sort();
      winner = sorted[sorted.length - 1];
    }
    toKeep.add(winner);
    for (const n of owners) {
      if (n !== winner) toBackup.add(n);
    }
  }

  // 没冲突的文件一律保留(只要不在 toBackup 中)
  for (const f of files) {
    if (!toBackup.has(f.name)) toKeep.add(f.name);
  }

  const log =
    conflicts.length === 0
      ? `drop-in.cleanup no_conflicts files=${files.length}`
      : `drop-in.cleanup conflicts=${conflicts
          .map((c) => `${c.key}@[${c.files.join(",")}]`)
          .join(";")} removed=[${[...toBackup].join(",")}] kept=[${[...toKeep].join(",")}]`;

  return {
    conflicts,
    toBackup: [...toBackup],
    toKeep: [...toKeep],
    log,
  };
}
