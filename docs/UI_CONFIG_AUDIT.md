# UI 硬编码选项扫描清单

> 目标:把所有"业务枚举"类下拉/筛选选项从源码里迁到配置中心(`/api/settings`),通过 `useSettings().getValues(key, fallback)` 读取。
> 排除项:角色 (admin/leader/normal)、分页 `[10,20,50,100]`、`constants.ts` 色卡(enum→颜色)、文件类型、技术参数(力导向/层次/辐射、link/custom 等)。

## 状态总览

| 项 | 数量 |
|---|---|
| 已迁(用 `getValues`) | 13 处 |
| 待迁(本轮目标) | 8 处 |
| 已排除(不算硬编码) | 6 处 |

## 待迁清单(本轮处理)

| 文件:行 | 控件 | 当前硬编码 | settings key | 默认值 | 状态 |
|---|---|---|---|---|---|
| `components/FloatingFeedback.tsx:10` | `Select` 严重程度 | `['严重','较高','一般','建议']` | `Bug 严重程度` | `['严重','较高','一般','建议']` | 待迁 |
| `pages/BugReport.tsx:268` | `Select` 状态筛选 | `['待处理','处理中','已解决','已关闭']` | `Bug 状态` | `['待处理','处理中','已解决','已关闭']` | 待迁 |
| `pages/BugReport.tsx:311` | `Select` 严重程度(提交) | `['严重','较高','一般','建议']` | `Bug 严重程度` | 同上 | 待迁 |
| `pages/BugReport.tsx:484` | `Select` 严重程度(编辑) | `['严重','较高','一般','建议']` | `Bug 严重程度` | 同上 | 待迁 |
| `pages/ProposalsPage.tsx:232` | `Select` 状态筛选 | `['待审批','已通过','已拒绝']` | `提案状态` | `['待审批','已通过','已拒绝']` | 待迁 |
| `pages/RemindersPage.tsx:184` | `Select` 状态筛选 | `['待发送','已发送','已忽略']` | `提醒状态` | `['待发送','已发送','已忽略']` | 待迁 |
| `pages/AttackDetail.tsx:43,1011` | `Select` 团队角色 | `['组长','组员']` | `团队角色` | `['组长','组员']` | 待迁 |
| `pages/InfoSquare.tsx:128-133` | `Select` 信息分类/重要程度 fallback | 内联 `['通知','公告',...]` | `信息分类`/`重要程度` | 已用 getValues,只需把 inline fallback 折进 `getValues(key, fallback)` 二参 | 待整理 |

## 已迁(只列查证位置,本轮不改)

| 文件:行 | 控件 | settings key |
|---|---|---|
| `pages/AttackDetail.tsx:148` | 攻关单状态 | `状态` |
| `pages/AttackDetail.tsx:149` | 求助分类 | `求助分类` |
| `pages/AttackDetail.tsx:150` | 求助状态 | `求助状态` |
| `pages/AttackDetail.tsx:151` | 日报类型 | `日报类型` |
| `pages/AttackList.tsx:70` | 攻关单状态 | `状态` |
| `pages/AttackList.tsx:71` | 事件级别 | `事件级别` |
| `pages/Contributions.tsx:22` | 贡献类型 | `贡献类型` |
| `pages/Contributions.tsx:23` | 贡献等级 | `贡献等级` |
| `pages/HelpCenter.tsx:35` | 求助分类 | `求助分类` |
| `pages/HelpCenter.tsx:36` | 求助中心状态 | `求助中心状态` |
| `pages/InfoSquare.tsx:51` | 信息分类 | `信息分类` |
| `pages/InfoSquare.tsx:52` | 重要程度 | `重要程度` |
| `components/DynamicField.tsx:23` | schema 字段动态枚举 | 由 schema `optionsKey` 指定 |

## 已排除(算"对的"硬编码)

| 文件:行 | 原因 |
|---|---|
| `pages/UserManagement.tsx:15` `ROLE_OPTIONS` | 角色码(admin/leader/normal),系统层级,不属于业务枚举 |
| `pages/BackupRestore.tsx:23` `INTERVAL_OPTIONS` | 备份周期(24h/168h/720h),技术参数 + 数值映射,不适合字符串配置 |
| `pages/KGGraph.tsx:338` 力导向/层次/辐射 | 图布局算法常量,KG 渲染引擎相关 |
| `pages/SearchPage.tsx:198` attackTicket/person/contribution | nodeType 代码,由 schema 决定 |
| `pages/RelatedPage.tsx:69` `[1,2,3]` | hop 数值,算法参数 |
| `pages/AttackDetail.tsx:143` `SIDEBAR_CARD_OPTIONS` | 侧边栏卡片清单,UI 布局而非业务枚举 |
| `constants.ts` `STATUS_COLOR` 等 | enum→颜色映射,见 CLAUDE.md 设计规范 |
| `components/AddTabModal.tsx:66` Radio.Group link/custom | 标签类型代码 |

## 迁移规范

```ts
// ❌ before
const SEVERITY_OPTIONS = ['严重', '较高', '一般', '建议'].map(v => ({ value: v, label: v }));
<Select options={SEVERITY_OPTIONS} />

// ✓ after
const { getValues } = useSettings();
const severities = getValues('Bug 严重程度', ['严重', '较高', '一般', '建议']);
<Select options={severities.map(v => ({ value: v, label: v }))} />
```

**铁律**:
1. fallback 必填(保留原硬编码),配置中心被清空或网络失败时 UI 仍可用。
2. 类型 `string[]`,不传对象。
3. 不要在 render 函数里 fetch,只用 `useSettings()` hook。
4. seed 走 `scripts/settings-seed.mjs`,部署时跑一次即可。
