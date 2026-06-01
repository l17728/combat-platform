# 多视图操作指南 (v2.3.5+)

> One Data Model, Many Views —— 同一份数据,不同观察角度。本文档说明攻关单与贡献数据的多视图能力,包含操作技巧与适用场景。

## 视图全景

| 模块       | 视图                | URL 参数                          | 适用场景                         |
| ---------- | ------------------- | --------------------------------- | -------------------------------- |
| 攻关作战台 | **表格**            | `/attack` 或 `?view=table`        | 大批量筛选、按字段排序、批量操作 |
| 攻关作战台 | **看板 (Kanban)**   | `/attack?view=kanban`             | 按状态可视化推进、拖拽改状态     |
| 攻关作战台 | **日历 (Calendar)** | `/attack?view=calendar`           | 工作量分布、热点日定位           |
| 贡献录入   | **表格**            | `/contributions` 或 `?view=table` | 单条录入/编辑、明细审阅          |
| 贡献录入   | **透视 (Pivot)**    | `/contributions?view=pivot`       | 人均/团队加权积分热力图          |

视图切换器位于页面顶部的 `<Segmented>` 控件,URL 会自动同步参数,刷新/分享链接都能恢复同一视图。**切换视图不会重置 filter 和分页。**

---

## 一、看板视图 (Kanban) — `/attack?view=kanban`

### 列布局

列按 `attackTicket.json` schema 中 `状态` 字段的 `enumValues` 拆分,默认 5 列:

```
待响应 (gold) → 处理中 (blue) → 进行中 (cyan) → 已解决 (green) → 已关闭 (default)
```

每列头部显示:`<Tag 颜色>状态名</Tag>  N`(N 为本列卡片数)。每列内独立纵向滚动。

### 卡片信息(4-6 行紧凑布局)

- 🔒 私密图标(若是)+ **标题**
- 事件级别 Tag(P0/P1 红、P2 橙、P3+ 蓝)+ 处理人
- 客户名称
- **状态 Select(降级路径)** —— 不支持拖拽时也能改状态

### 拖拽改状态 (HTML5 native DnD)

1. 鼠标按住卡片任意空白处 → 拖到目标列 → 松手
2. 前端**乐观更新**(卡片立刻飞到目标列)
3. 同时调用 `POST /api/nodes/:id/transition`,note=`看板拖拽`,写入审计日志
4. **失败回滚**:卡片回到原列,弹出错误 toast

### 降级路径(无 DnD)

每张卡片底部的 `Select` 直接选目标状态,等价于拖拽。**这是 E2E 测试和不支持 HTML5 DnD 浏览器的契约**,任何场景都可用。

### 卡片点击

点击卡片**空白区域**跳到该攻关单详情页。点击 `Select` 控件不会跳转。

### 适用场景

- 站会前 5 分钟扫描 "待响应" 列;
- 拖一批 "处理中" 到 "已解决";
- 高 P 级单一眼可辨;
- 屏幕 stream + 物理白板替代。

---

## 二、日历视图 (Calendar) — `/attack?view=calendar`

### 时间轴切换

顶部 `Switch` 切换数据时间维度:

- **创建时间**(默认)
- **更新时间**

切换后整张日历的色块和小卡列表都按新维度重排。

### 单元格(日)显示

- 当日有 N 条 → 显示 `<Text>N 条</Text>`,文字与色块同色
- 色块取**该日最严重的事件级别**:
  - P0/P1 → 红色(`#ff4d4f`)
  - P2 → 橙色(`#fa8c16`)
  - P3+ → 蓝色(`#1677ff`)
  - 无 → 灰色(`#bfbfbf`)
- 没有数据的日不渲染色块

### 点单元格 → 小卡列表

- Popover 弹出当日最多 20 条记录
- 每条:标题(链接)+ 状态 Tag + 级别 Tag
- 点标题跳详情;超 20 条显示「还有 N 条…」

### 月切换

使用 antd `Calendar` 自带的月份/年份切换器(顶部右侧)。

### 适用场景

- 月度复盘看分布热力(连续几天红块 = 风险窗口)
- 给客户看「我们这周处理了多少 P1」
- 切到「更新时间」看实际跟进的活跃日

---

## 三、透视视图 (Pivot) — `/contributions?view=pivot`

### 模式切换

顶部 Segmented 切换两种透视:

- **个人贡献**(默认)—— 行 = 贡献人
- **团队贡献** —— 行 = 团队名称

### 行/列/值

- **行**:贡献人 / 团队名称,按总积分降序
- **列**:`贡献类型` 枚举(从 settings/schema 读)
- **值(单元格)**:
  - 上行:次数(`-` 表示 0)
  - 下行:加权积分(核心=3、关键=2、普通=1)
- **背景色梯度**:蓝色,积分越高背景越深(rgba alpha 0.08~0.55)

### 行尾「小计」

固定在右侧的列,显示该人/团队的总次数 + 总加权积分。

### 列尾「总计」行

表格底部固定行(`Table.Summary`),显示每个贡献类型的总次数 + 总分,**右下角 grand total** 蓝色高亮总数。

### 适用场景

- 月报/季报:一张图看全员产出结构
- 答辩材料:截图直接贴
- 团队负责人分配资源:谁某类贡献偏少 → 安排该类任务

---

## 操作技巧

### URL 与分享

- 直接分享 `https://.../attack?view=kanban&q=华为云` → 别人打开就是同一筛选 + 看板
- `view` 参数缺省 → 表格视图
- Filter / Search 参数全部保留,在任何视图下都生效

### 截图与导出

- **截图**:Windows `Win+Shift+S`(看板/日历/透视都支持)
- **导出**:仅 `表格` 视图有「导出」按钮(xlsx);需要看板/日历/透视数据 → 先在表格视图导出,再用 Excel 透视分析

### 打印

- 浏览器自带 `Ctrl+P` 通常可打印日历/透视(看板因横向滚动建议改导出)
- 提前在表格视图筛选好,再切目标视图打印

### 视图与其它特性的组合

- **关注**:仅表格视图有 ★ 列;在表格关注后,切到看板/日历可见所有关注单(因 filter 跟着走)
- **私密单**:看板/日历/透视都遵守私密规则,无权访问的单子根本不会出现在数据里
- **批量操作**:仅表格视图;看板/日历不参与多选(拖拽即逐条改)

---

## 实现笔记(给开发者)

| 文件                                                             | 说明                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------- |
| `apps/frontend-v2/src/pages/attackList/AttackKanban.tsx`         | HTML5 native DnD,乐观更新 + 失败回滚;Select 降级              |
| `apps/frontend-v2/src/pages/attackList/AttackCalendar.tsx`       | antd `Calendar fullscreen` + Popover 小卡列表                 |
| `apps/frontend-v2/src/pages/contributions/ContributionPivot.tsx` | 行/列/值聚合 + 加权积分 + 单元格背景梯度 + Table.Summary 列尾 |
| `apps/frontend-v2/src/pages/AttackList.tsx`                      | Segmented 视图切换器 + URL 同步 (`?view=`)                    |
| `apps/frontend-v2/src/pages/Contributions.tsx`                   | Segmented 视图切换器 + URL 同步 (`?view=`)                    |
| `apps/frontend-v2/e2e/views-kanban.spec.ts`                      | 看板 5 个 e2e(切换/降级/拖拽/直链/点详情)                     |
| `apps/frontend-v2/e2e/views-calendar.spec.ts`                    | 日历 4 个 e2e(切换/单元格/Switch/月切换)                      |
| `apps/frontend-v2/e2e/views-pivot.spec.ts`                       | 透视 3 个 e2e(切换/直链/团队透视)                             |

### 视图与数据模型(铁律)

看板、日历、透视都是 **`attackTicket` / `contribution` / `teamContribution` 这同一份数据**的**投影**,**不引入新的表/新的字段**。这是「One Data Model, Many Views」的体现。任何视图问题先想"投影正确否",再想"数据正确否"。

### 拖拽降级契约

- HTML5 native DnD 在 Playwright Chromium 下有时不稳;**因此卡片必须包含 Select 作为降级**
- 任何"拖拽改状态"必然写后端 `POST /api/nodes/:id/transition`,等价于"详情页状态流转"按钮 → 走相同审计 + 通知链路
- 失败必然回滚 + toast,不允许"前端显示成功、后端没写"的虚假成功
