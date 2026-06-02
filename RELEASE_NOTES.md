# Release Notes

## v2.9.0 (2026-06-02)

### 知识库 (Wiki) 大版本更新

- **点赞系统**: 文章可点赞/取消点赞，按点赞数排序（加锁 → 点赞 → 普通 三级排序）
- **加锁/密码保护**: 文章可加锁并设置密码，删除加锁文章需输入密码（timingSafeEqual 防时序攻击）
- **编辑权限**: 加锁文章仅创建者或管理员可编辑
- **删除权限**: 仅创建者或管理员可删除；删除后自动聚焦相邻文章
- **分 tier 拖拽**: 拖拽排序仅在同级别（加锁/点赞/普通）内生效
- **审计日志**: 创建/编辑/删除/点赞操作自动写入 audit_log 表

### MarkdownRenderer 全新渲染引擎

- **Mermaid 图**: ` ```mermaid ` 代码块自动渲染为 SVG 流程图/时序图等
- **YouTube 视频**: YouTube 链接渲染为缩略图+播放按钮（大陆不可直接 iframe 嵌入）
- **Bilibili 嵌入**: `<iframe src="player.bilibili.com/...">` 渲染为响应式播放器，`bilibili.com/video/BVxxx` 自动转换为 embed URL
- **HTML video**: `<video controls><source src="..." type="video/mp4"></video>` 直链视频内嵌播放
- **安全**: rehype-raw + rehype-sanitize 白名单，仅允许 video/source/iframe 标签，iframe 域名限制 YouTube/Bilibili

### 修复

- DashboardScreen 最近活跃 undefined → 后端返回扁平结构适配
- 文档上传 HTTP 500 → FormData 不再被覆盖为 application/json
- Wiki 列表布局: 放弃 List.Item actions 改用 flex 布局，防止标题被挤压空白

### 边类型重命名 (v2.8.0)

- REF → 分配, CONFLICTS_WITH → 冲突, ANCHORED_TO → 关联, ESCALATED_TO → 上报, RELATES_TO → 处理, OVERLAPS_WITH → 重叠
- 影响 ~40 个文件 + 生产数据库 1,187 条边

---

## v2.8.0 (2026-06-01)

- 知识图谱可视化优化: 边按类型着色 + 图例 + hover tooltip + 节点类型筛选
- 边类型重命名 (6 种中文类型)
- Hermes 文字驱动 UI 操作 + 写工具启用
- Weink AI 四级 fallback

## v2.7.0 (2026-05-30)

- 知识图谱冲突检测与重叠关系
- 攻关单详情页增强

## v2.6.0 (2026-05-28)

- HermesChat AI 助手集成
- 知识库基础功能

## v2.5.0 (2026-05-25)

- 仪表盘大屏
- 文档上传管理

## v2.4.1 (2026-05-22)

- 权限系统优化
- Bug 修复
