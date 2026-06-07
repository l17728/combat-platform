# 前端 UI 功能铺设设计文档

> 本文档覆盖 16 个后端已实现但缺少前端 UI 的 API，按优先级排列。
> 每个功能包含：页面结构、组件设计、API 集成、路由定义、交互流程。

---

## 设计规范（现有代码库约定）

### 页面模式

- 函数式组件 + hooks（useState/useEffect/useCallback）
- Ant Design 组件库（Table/Card/Modal/Form/Space/Button/Popconfirm/Tag）
- API 调用统一通过 `api.ts` 的 `Api` 类
- 系统管理页面使用 `useGuestGuard()` 保护写操作
- 帮助按钮 `HelpButton` + `help-content.ts` 内联文档
- 分页常量 `PAGE_SIZE` / `PAGE_SIZE_OPTIONS` from `constants.ts`
- 错误处理 `handleApiError(e)` from `utils/handleApiError.ts`
- 路由注册：`App.tsx` 中 lazy import + `<Route path="..." element={<... />} />`
- 菜单注册：`AppLayout.tsx` 中 sidebar menu items

### API 集成模式

```typescript
// api.ts 中新增方法
methodName(params): Promise<ReturnType> {
  return this.req<ReturnType>("/api/endpoint", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
}
```

### 类型定义

- 前端特有类型 → `api.ts` 底部 export interface
- 前后端共享类型 → `packages/shared/src/types.ts`

---

## 一、文档下载入口（P0）

### 现状分析

后端 `GET /api/documents/:id/download` 已实现（公开免鉴权，`auth.ts` 白名单）。
前端 `DocumentCenter.tsx` 已有下载功能（`window.open(docUrl, "_blank")`），但 `docUrl` 构造为 `${origin}/api/documents/${d.id}/download`。

**结论**：文档下载实际上已经工作。当前"下载"按钮在操作列中已存在（line 202: `window.open(docUrl, "_blank")`）。

### 建议改进（非必须）

- 文件类型文档的按钮文字从"下载"改为明确的下载图标 + 文字
- 添加"另存为..."下载方式（当前是 inline 显示，可改为 attachment 下载）

**工作量**：0（已实现）→ 可选微调 0.5h

---

## 二、支撑模板删除（P0）

### 现状分析

- 后端 `DELETE /api/support-templates/:templateId` 已实现
- 前端 `api.ts` 已有 `listSupportTemplates()` 和 `applySupportTemplate()`，但缺少 `deleteSupportTemplate()`
- 支撑模板在 `AttackSupportNetworkTab.tsx` 中以列表展示，无删除入口

### 设计

#### API 新增（api.ts）

```typescript
deleteSupportTemplate(templateId: string): Promise<{ deleted: number }> {
  return this.req(`/api/support-templates/${templateId}`, { method: "DELETE" });
}
```

#### UI 修改

修改文件：`apps/frontend-v2/src/pages/attackDetail/AttackSupportNetworkTab.tsx`

在模板列表（当前展示 SupportTemplate[] 的位置）每行末尾添加删除按钮：

- `<Popconfirm>` 确认框："确认删除模板「{name}」？"
- 调用 `api.deleteSupportTemplate(id)`
- 成功后 `message.success("模板已删除")` 并刷新列表

#### 交互流程

1. 用户在攻关单详情 → 支撑网络 Tab → 看到模板列表
2. 点击某模板行右侧"删除"链接（红色）
3. 弹出确认对话框："确认删除模板「XXX」？该操作不可恢复。"
4. 确认 → 调用 DELETE API → 刷新列表

#### 权限

- 需使用 `useGuestGuard()` — guest 不可删除
- 仅 admin/普通用户可操作

**工作量**：1h

---

## 三、手动关系管理（P1）

### 后端 API 契约

| 方法   | 路径                               | 请求                                            | 响应                                                  |
| ------ | ---------------------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| POST   | `/api/relations/manual`            | `{ sourceId, targetId, reason?, sourceField? }` | `{ edgeId, sourceId, targetId, sourceField, reason }` |
| GET    | `/api/relations/manual?nodeId=xxx` | query: nodeId                                   | `ManualLinkView[]`                                    |
| DELETE | `/api/relations/manual/:edgeId`    | -                                               | `{ ok: true }`                                        |

### 设计

#### 新增类型（api.ts）

```typescript
export interface ManualRelation {
  edgeId: string;
  sourceId: string;
  targetId: string;
  sourceField?: string;
  reason: string;
}
```

#### 新增 API 方法（api.ts）

```typescript
createManualRelation(data: { sourceId: string; targetId: string; reason?: string; sourceField?: string }): Promise<ManualRelation> {
  return this.req<ManualRelation>("/api/relations/manual", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
}

listManualRelations(nodeId: string): Promise<ManualLinkView[]> {
  return this.req<ManualLinkView[]>(`/api/relations/manual?nodeId=${encodeURIComponent(nodeId)}`);
}

deleteManualRelation(edgeId: string): Promise<{ ok: boolean }> {
  return this.req(`/api/relations/manual/${encodeURIComponent(edgeId)}`, { method: "DELETE" });
}
```

#### UI 方案 A：节点详情页内嵌（推荐）

修改文件：`apps/frontend-v2/src/pages/RelatedPage.tsx`（或节点详情页的"关联"Tab）

在现有的关系列表区域增加"手动关联"功能：

1. **创建关系**
   - 新增"手动关联"按钮 → 弹出 Modal
   - Modal 内：
     - 源节点（当前节点，只读显示）
     - 目标节点：搜索框（调用 `api.searchNodes()` 实时搜索）
     - 关联原因：Input.TextArea
     - 来源字段（可选）：Input
   - 提交 → `api.createManualRelation()` → 刷新关联列表

2. **查看关系**
   - 手动关系在现有列表中以特殊 Tag 标识（如 `<Tag color="orange">手动关联</Tag>`）
   - 显示原因和方向

3. **删除关系**
   - 每条手动关系右侧有删除按钮
   - `<Popconfirm>` 确认 → `api.deleteManualRelation()`

#### UI 方案 B：独立页面（备选）

新建文件：`apps/frontend-v2/src/pages/ManualRelations.tsx`

系统管理菜单下新增"手动关系"页面，表格展示所有手动关系。

**推荐方案 A**——手动关系是节点级别的操作，在上下文中操作更直观。

#### 菜单注册（方案 A 不需要，方案 B 需要）

方案 B：AppLayout.tsx → 系统管理 children 中新增 `{ key: "/manual-relations", label: "手动关系", icon: <LinkOutlined /> }`

**工作量**：方案 A 3h / 方案 B 4h

---

## 四、UI 置顶缓存 / 快捷访问（P1）

### 后端 API 契约

| 方法   | 路径                       | 请求                                                                   | 响应           |
| ------ | -------------------------- | ---------------------------------------------------------------------- | -------------- |
| GET    | `/api/ui-cache/pinned`     | -                                                                      | `PinnedUi[]`   |
| POST   | `/api/ui-cache/pin`        | `{ label?, question?, intent?, uiSpec: { widget, params, cacheKey } }` | `PinnedUi`     |
| PATCH  | `/api/ui-cache/pinned/:id` | `{ label }`                                                            | `PinnedUi`     |
| DELETE | `/api/ui-cache/pinned/:id` | -                                                                      | `{ ok: true }` |

### 设计分析

**注意**：后端的 `ui-cache/pin` API 设计为通用 widget 置顶系统（uiSpec 包含 widget 类型、参数、cacheKey），并非简单的"书签"概念。PinnedUi 包含 `question`（自然语言问题）、`intent`（意图类型）和 `uiSpec`（渲染规格）。

这意味着 UI 置顶的实际使用场景是：

1. AI 助手（Hermes）返回查询结果时附带 uiSpec → 用户点击"置顶此结果"
2. 置顶后的 widget 在首页/侧边栏快捷区域渲染

### 设计

#### 新增 API 方法（api.ts）

```typescript
listPinnedWidgets(): Promise<PinnedUi[]> {
  return this.req<PinnedUi[]>("/api/ui-cache/pinned");
}

pinWidget(data: { label?: string; question?: string; intent?: string; uiSpec: UiSpec }): Promise<PinnedUi> {
  return this.req<PinnedUi>("/api/ui-cache/pin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
}

renamePinnedWidget(id: string, label: string): Promise<PinnedUi> {
  return this.req(`/api/ui-cache/pinned/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label }),
  });
}

unpinWidget(id: string): Promise<{ ok: boolean }> {
  return this.req(`/api/ui-cache/pinned/${encodeURIComponent(id)}`, { method: "DELETE" });
}
```

#### UI 方案

##### 1. Hermes 聊天面板中的"置顶"按钮

修改文件：`apps/frontend-v2/src/components/HermesChat.tsx`（或 AI 助手相关组件）

- 当 Hermes 返回的 answer 包含 `uiSpec` 时，在回答气泡下方显示"📌 置顶到首页"按钮
- 点击 → 调用 `api.pinWidget({ label, question, intent, uiSpec })`
- 成功 → toast "已置顶到快捷访问"

##### 2. Dashboard 首页快捷访问区域

修改文件：`apps/frontend-v2/src/pages/Dashboard.tsx`

- 在 Dashboard 顶部新增"快捷访问"Card
- 展示 `api.listPinnedWidgets()` 返回的置顶项
- 每个置顶项渲染为小卡片，根据 `uiSpec.widget` 类型渲染对应组件（table/stats/timeline 等）
- 每个卡片右上角有：
  - 重命名（内联编辑 label）
  - 取消置顶（`api.unpinWidget(id)`）

##### 3. 置顶渲染器

新建文件：`apps/frontend-v2/src/components/PinnedWidgetRenderer.tsx`

根据 `uiSpec.widget` 类型分发渲染：

- `table` → 精简版 Table（最多 5 行）
- `stats` → Statistic 卡片组
- `mermaid` → Mermaid 图表
- `timeline` → Timeline 组件
- `card-grid` → 卡片网格

**工作量**：6h（含渲染器 3h + 集成 3h）

---

## 五、自定义命令系统（P2）

### 后端 API 契约

| 方法   | 路径                    | 请求                                | 响应                     |
| ------ | ----------------------- | ----------------------------------- | ------------------------ |
| GET    | `/api/commands`         | -                                   | `CustomCommand[]`        |
| POST   | `/api/commands`         | `{ name, template, description? }`  | `CustomCommand`          |
| DELETE | `/api/commands/:id`     | -                                   | `{ ok: true }`           |
| POST   | `/api/commands/:id/run` | `{ args: Record<string, unknown> }` | `CustomCommandRunResult` |

**类型**（已在 shared/types.ts 定义）：

```typescript
interface CustomCommand {
  id: string;
  name: string;
  description?: string;
  template: string;
  params: string[];
  createdAt: string;
}
interface CustomCommandRunResult {
  resolved: string;
  request: { method: string; path: string; body?: unknown };
}
```

### 设计

#### 新建页面

文件：`apps/frontend-v2/src/pages/CustomCommands.tsx`

#### 新增 API 方法（api.ts）

```typescript
listCommands(): Promise<CustomCommand[]> {
  return this.req<CustomCommand[]>("/api/commands");
}

createCommand(data: { name: string; template: string; description?: string }): Promise<CustomCommand> {
  return this.req<CustomCommand>("/api/commands", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
}

deleteCommand(id: string): Promise<{ ok: boolean }> {
  return this.req(`/api/commands/${encodeURIComponent(id)}`, { method: "DELETE" });
}

runCommand(id: string, args: Record<string, unknown>): Promise<CustomCommandRunResult> {
  return this.req<CustomCommandRunResult>(`/api/commands/${encodeURIComponent(id)}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args }),
  });
}
```

#### 页面布局

```
┌──────────────────────────────────────────────────────────┐
│ 自定义命令 <HelpButton>                    [新建命令] [刷新] │
├──────────────────────────────────────────────────────────┤
│ 📌 说明：自定义命令是系统内置 CLI 命令的快捷模板。           │
│ template 中使用 {参数名} 作为占位符，执行时填入实际值。        │
├──────────────────────────────────────────────────────────┤
│ Table                                                     │
│ ┌─────┬────────┬─────────────────────┬────────┬────────┐ │
│ │名称  │描述     │模板                  │参数     │操作    │ │
│ ├─────┼────────┼─────────────────────┼────────┼────────┤ │
│ │周报  │导出周报  │report:weekly {week}  │week    │▶ 删除 │ │
│ └─────┴────────┴─────────────────────┴────────┴────────┘ │
└──────────────────────────────────────────────────────────┘
```

#### 新建命令 Modal

- 命令名称：Input（必填）
- 命令描述：Input（可选）
- 命令模板：Input.TextArea（必填，placeholder: `如: report:weekly {week}`）
  - 输入时实时解析 `{param}` 占位符，下方显示"检测到参数：week"
- 验证：template 首空格前的 token 必须是已知命令（后端校验）

#### 执行命令 Modal

- 从 `cmd.params` 动态生成表单字段
- 每个参数一个 Input
- 提交后显示执行结果（resolved 命令 + request 对象）
- 结果区域用 `<pre>` 展示 JSON

#### 路由注册

`App.tsx`：

```tsx
const CustomCommands = lazy(() => import("./pages/CustomCommands.js"));
// ...
<Route path="/commands" element={<CustomCommands />} />;
```

#### 菜单注册

`AppLayout.tsx` → 系统管理 children 中新增：

```tsx
{ key: "/commands", label: "自定义命令", icon: <CodeOutlined /> }
```

#### 权限

- 使用 `useGuestGuard()` — guest 只读
- 帮助文档：`help-content.ts` 新增 `customCommands` 条目

**工作量**：4h

---

## 六、值班管理（P2）

### 后端 API 契约

| 方法 | 路径                  | 请求             | 响应                 |
| ---- | --------------------- | ---------------- | -------------------- |
| GET  | `/api/oncall/current` | query: `domain?` | `OncallCurrentRow[]` |

**类型**：

```typescript
interface OncallCurrentRow {
  domain: string;
  值班人: string[];
}
```

### 设计

#### 方案 A：Dashboard 卡片（推荐）

修改文件：`apps/frontend-v2/src/pages/Dashboard.tsx`

在 Dashboard 顶部新增"今日值班"Card：

- 调用 `api.getOncallCurrent()`
- 按 domain 分组展示
- 每个 domain 一个 `<Tag>` 或小卡片，列出值班人姓名

```tsx
// Dashboard 中新增
<Card title="📋 今日值班" size="small" style={{ marginBottom: 16 }}>
  <Space direction="vertical" style={{ width: "100%" }}>
    {oncallData.map((row) => (
      <div key={row.domain}>
        <Text strong>{row.domain}</Text>
        <div>
          {row.值班人.map((name) => (
            <Tag key={name} color="blue">
              {name}
            </Tag>
          ))}
        </div>
      </div>
    ))}
    {oncallData.length === 0 && <Text type="secondary">今日无值班安排</Text>}
  </Space>
</Card>
```

#### 方案 B：独立系统管理页面

新建文件：`apps/frontend-v2/src/pages/OncallSchedule.tsx`

展示值班表（需要排班数据录入功能——但后端目前只有查询 API，无排班 CRUD）。

**推荐方案 A**——当前只有查询 API，不需要独立管理页面。等后端补齐排班 CRUD 后再扩展为独立页面。

#### 新增 API 方法（api.ts）

```typescript
getOncallCurrent(domain?: string): Promise<OncallCurrentRow[]> {
  const qs = domain ? `?domain=${encodeURIComponent(domain)}` : "";
  return this.req<OncallCurrentRow[]>(`/api/oncall/current${qs}`);
}
```

**工作量**：方案 A 1.5h / 方案 B 4h（需后端配合）

---

## 七、责任图谱可视化（P2）

### 后端 API 契约

| 方法 | 路径                          | 请求 | 响应                                                        |
| ---- | ----------------------------- | ---- | ----------------------------------------------------------- |
| GET  | `/api/responsibility/diagram` | -    | `{ mermaid: string, nodeCount: number, edgeCount: number }` |

### 设计

#### 方案：系统管理页面 + Mermaid 渲染

新建文件：`apps/frontend-v2/src/pages/ResponsibilityDiagram.tsx`

#### 页面布局

```
┌──────────────────────────────────────────────────────────┐
│ 责任图谱 <HelpButton>                        [刷新] [全屏]  │
├──────────────────────────────────────────────────────────┤
│ 📊 统计：{nodeCount} 个节点 / {edgeCount} 条关系            │
├──────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────┐ │
│ │                                                      │ │
│ │              Mermaid flowchart 渲染区域                │ │
│ │                                                      │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

#### 技术方案

- 使用 `mermaid` npm 包渲染（已有依赖？需确认）
- 或使用 `<iframe>` + Mermaid Live Editor API（离线方案）
- 推荐直接引入 `mermaid` 包

```tsx
import mermaid from "mermaid";

// 渲染
useEffect(() => {
  if (data?.mermaid) {
    mermaid.render("responsibility-diagram", data.mermaid).then(({ svg }) => {
      containerRef.current.innerHTML = svg;
    });
  }
}, [data]);
```

#### 新增 API 方法（api.ts）

```typescript
getResponsibilityDiagram(): Promise<{ mermaid: string; nodeCount: number; edgeCount: number }> {
  return this.req("/api/responsibility/diagram");
}
```

#### 路由注册

`App.tsx`：

```tsx
const ResponsibilityDiagram = lazy(() => import("./pages/ResponsibilityDiagram.js"));
<Route path="/responsibility" element={<ResponsibilityDiagram />} />;
```

#### 菜单注册

`AppLayout.tsx` → 系统管理 children 中新增：

```tsx
{ key: "/responsibility", label: "责任图谱", icon: <ApartmentOutlined /> }
```

**工作量**：3h

---

## 八、异地备份（P3）

### 后端 API 契约

| 方法 | 路径                  | 请求                                                                                                   | 响应                              |
| ---- | --------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------- |
| POST | `/api/backup/offsite` | `{ host, user, port?, remoteDir, keyPath?, dbPath?, schemasDir?, overlayDir?, sshPassword?, dryRun? }` | `{ ok: true, summary?, stdout? }` |

### 设计

#### 修改现有页面

文件：`apps/frontend-v2/src/pages/BackupRestore.tsx`

在现有"立即备份"和"恢复数据库"按钮旁边新增"异地备份"按钮。

#### UI 方案

##### 1. 异地备份按钮

在操作区新增：

```tsx
<Button icon={<CloudUploadOutlined />} onClick={() => setOffsiteOpen(true)}>
  异地备份
</Button>
```

##### 2. 异地备份 Modal

```
┌─────────────────────────────────────────────┐
│ 异地备份配置                            [×]  │
├─────────────────────────────────────────────┤
│ ⚠️ 将当前数据库备份推送到远程服务器            │
│                                              │
│ 目标主机*  [____________]  例: 192.168.1.100  │
│ SSH 用户*  [____________]  例: root           │
│ SSH 端口   [___22______]                      │
│ 远程目录*  [____________]  例: /backup/combat  │
│ 密钥路径   [____________]  例: ~/.ssh/id_rsa  │
│ SSH 密码   [____________]  (可选，优先密钥)    │
│                                              │
│ ☐ Dry Run（仅测试连接，不实际传输）            │
│                                              │
│              [取消]  [开始备份]                │
└─────────────────────────────────────────────┘
```

##### 3. 执行结果展示

- 成功：显示 summary（文件名、大小、传输时间）
- 失败：显示 stderr 错误信息
- 执行中：Modal footer 显示 loading 状态

#### 新增 API 方法（api.ts）

```typescript
offsiteBackup(config: {
  host: string; user: string; port?: number;
  remoteDir: string; keyPath?: string;
  sshPassword?: string; dryRun?: boolean;
}): Promise<{ ok: boolean; summary?: unknown; stdout?: string }> {
  return this.req("/api/backup/offsite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config),
  });
}
```

#### 权限

- 使用 `useGuestGuard()` — guest 不可操作
- 建议：仅 admin 可见此按钮（异地备份是高危操作）

**工作量**：3h

---

## 实现优先级与工作量汇总

| 优先级   | 功能         | 实际工作量       | 新建页面              | 修改页面                | 新增 API 方法   |
| -------- | ------------ | ---------------- | --------------------- | ----------------------- | --------------- |
| P0       | 文档下载入口 | **0h**（已实现） | -                     | -                       | -               |
| P0       | 支撑模板删除 | **1h**           | -                     | AttackSupportNetworkTab | 1               |
| P1       | 手动关系管理 | **3h**           | -                     | RelatedPage             | 3               |
| P1       | UI 置顶缓存  | **6h**           | PinnedWidgetRenderer  | Dashboard + HermesChat  | 4               |
| P2       | 自定义命令   | **4h**           | CustomCommands        | -                       | 4               |
| P2       | 值班管理     | **1.5h**         | -                     | Dashboard               | 1               |
| P2       | 责任图谱     | **3h**           | ResponsibilityDiagram | -                       | 1               |
| P3       | 异地备份     | **3h**           | -                     | BackupRestore           | 1               |
| **合计** |              | **21.5h**        | **3 新文件**          | **5 现有文件**          | **15 API 方法** |

---

## 路由变更清单

### App.tsx 新增路由

```tsx
// P2: 自定义命令
<Route path="/commands" element={<CustomCommands />} />
// P2: 责任图谱
<Route path="/responsibility" element={<ResponsibilityDiagram />} />
```

### AppLayout.tsx 菜单变更

系统管理 children 中新增（位置：备份恢复之后）：

```tsx
{ key: "/commands", label: "自定义命令", icon: <CodeOutlined /> },
{ key: "/responsibility", label: "责任图谱", icon: <ApartmentOutlined /> },
```

---

## help-content.ts 新增条目

### customCommands

```markdown
## 自定义命令

自定义命令是系统内置 CLI 的快捷模板。管理员可以预定义常用操作，
用户一键执行。

### 创建命令

- 命令模板使用 {参数名} 作为占位符
- 模板首词必须是已知 CLI 命令（如 report:weekly、node:list 等）
- 示例：`report:weekly {week}` → 执行时填入周次

### 执行命令

- 点击命令行的"执行"按钮
- 系统根据模板参数动态生成输入表单
- 填入参数值后提交，查看执行结果
```

### responsibilityDiagram

```markdown
## 责任图谱

责任图谱以流程图形式展示系统的责任分配关系：

- **升级链**：事件级别 → SLA → 上升角色
- **人员分配**：每个角色负责的攻关单
- **冲突关系**：攻关单之间的冲突以虚线表示

图谱数据来源于系统中的实际关系数据，实时生成。
```

---

## 共享类型引用

以下类型已在 `packages/shared/src/types.ts` 中定义，前端可直接使用：

| 类型                      | 用途                |
| ------------------------- | ------------------- |
| `CustomCommand`           | 自定义命令列表/创建 |
| `CustomCommandRunResult`  | 命令执行结果        |
| `PinnedUi`                | 置顶 widget 数据    |
| `ManualLinkView`          | 手动关联视图        |
| `OncallCurrentRow`        | 值班信息            |
| `UiSpec` / `UiWidgetType` | Widget 渲染规格     |

---

## 注意事项

1. **Guest 权限**：所有写操作（创建/删除/执行）需经 `useGuestGuard()` 检查
2. **租户隔离**：后端 API 已通过 JWT 中的 tenantId 自动隔离，前端无需额外处理
3. **TypeScript 严格模式**：禁止 `as any`、`@ts-ignore`、`@ts-expect-error`
4. **错误处理**：所有 API 调用需 try/catch + `handleApiError(e)`
5. **分页**：列表类页面使用 `PAGE_SIZE` / `PAGE_SIZE_OPTIONS` 常量
6. **懒加载**：新页面必须 lazy import，不增加首屏 bundle 大小
