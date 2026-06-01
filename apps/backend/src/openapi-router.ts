import { Router } from "express";
import { log } from "./logger.js";

export function makeOpenApiRouter(): Router {
  const router = Router();

  router.get("/openapi.json", (_req, res) => {
    const spec = buildOpenApiSpec();
    res.json(spec);
  });

  router.get("/api-docs", (_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.send(swaggerUiHtml());
  });

  return router;
}

function buildOpenApiSpec() {
  const spec: Record<string, unknown> = {
    openapi: "3.0.3",
    info: {
      title: "作战管理平台 API",
      version: "2.3.10",
      description: "Config-driven combat management platform with 50+ endpoints",
    },
    servers: [{ url: "/api", description: "Current server" }],
    tags: [
      { name: "认证", description: "登录、注册、用户管理" },
      { name: "节点CRUD", description: "通用节点增删改查（16+ nodeType）" },
      { name: "Schema", description: "动态字段管理" },
      { name: "搜索与关联", description: "全文搜索、关联关系、知识图谱" },
      { name: "仪表盘", description: "作战态势概览、统计" },
      { name: "导入导出", description: "Excel 导入导出、备份恢复" },
      { name: "邮件", description: "SMTP 配置、邮件摘要、Webhook" },
      { name: "AI", description: "Hermes 问答、LLM 设置" },
      { name: "邀请管理", description: "邀请码注册、角色分配" },
      { name: "知识库", description: "Wiki 文章管理" },
      { name: "系统管理", description: "审计日志、配置中心、用户管理、升级" },
    ],
    paths: {},
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
  };

  const paths = spec.paths as Record<string, Record<string, unknown>>;

  // Auth
  addPath(paths, "/auth/login", "post", {
    tags: ["认证"],
    summary: "用户登录",
    requestBody: ref("#/components/requestBodies/Login"),
    responses: { "200": { description: "返回 JWT token" }, "401": { description: "用户名或密码错误" } },
  });
  addPath(paths, "/auth/register", "post", {
    tags: ["认证"],
    summary: "用户注册",
    requestBody: ref("#/components/requestBodies/Register"),
    responses: { "201": { description: "注册成功" } },
  });
  addPath(paths, "/auth/me", "get", { tags: ["认证"], summary: "获取当前用户信息", security: bearer() });
  addPath(paths, "/auth/users", "get", { tags: ["认证"], summary: "用户列表（admin）", security: bearer() });
  addPath(paths, "/auth/change-password", "post", { tags: ["认证"], summary: "修改密码", security: bearer() });

  // Nodes CRUD
  addPath(paths, "/nodes/{nodeType}", "get", {
    tags: ["节点CRUD"],
    summary: "列出某类型的所有节点",
    parameters: pathParam("nodeType", "节点类型"),
  });
  addPath(paths, "/nodes/{nodeType}", "post", {
    tags: ["节点CRUD"],
    summary: "创建节点",
    parameters: pathParam("nodeType", "节点类型"),
  });
  addPath(paths, "/nodes/{id}", "get", {
    tags: ["节点CRUD"],
    summary: "获取节点详情",
    parameters: pathParam("id", "节点ID"),
  });
  addPath(paths, "/nodes/{id}", "put", {
    tags: ["节点CRUD"],
    summary: "更新节点",
    parameters: pathParam("id", "节点ID"),
  });
  addPath(paths, "/nodes/{id}", "delete", {
    tags: ["节点CRUD"],
    summary: "删除节点",
    parameters: pathParam("id", "节点ID"),
  });
  addPath(paths, "/nodes/{id}/progress", "get", {
    tags: ["节点CRUD"],
    summary: "获取进展时间线",
    parameters: pathParam("id", "节点ID"),
  });
  addPath(paths, "/nodes/{id}/progress", "post", {
    tags: ["节点CRUD"],
    summary: "追加进展",
    parameters: pathParam("id", "节点ID"),
  });
  addPath(paths, "/nodes/{id}/transition", "post", {
    tags: ["节点CRUD"],
    summary: "状态流转",
    parameters: pathParam("id", "节点ID"),
  });

  // Schema
  addPath(paths, "/schema/{nodeType}", "get", {
    tags: ["Schema"],
    summary: "获取节点类型 schema",
    parameters: pathParam("nodeType", "节点类型"),
  });
  addPath(paths, "/schema/{nodeType}", "patch", {
    tags: ["Schema"],
    summary: "修改 schema（字段增删）",
    parameters: pathParam("nodeType", "节点类型"),
  });

  // Search & Relations
  addPath(paths, "/search", "get", { tags: ["搜索与关联"], summary: "全文搜索" });
  addPath(paths, "/related/{nodeType}/{id}", "get", {
    tags: ["搜索与关联"],
    summary: "获取关联节点",
    parameters: [pathParam("nodeType", "节点类型"), pathParam("id", "节点ID")],
  });
  addPath(paths, "/graph/snapshot/{id}", "get", {
    tags: ["搜索与关联"],
    summary: "知识图谱快照",
    parameters: pathParam("id", "中心节点ID"),
  });
  addPath(paths, "/kg/graph", "get", { tags: ["搜索与关联"], summary: "KG 图数据" });

  // Dashboard
  addPath(paths, "/dashboard", "get", { tags: ["仪表盘"], summary: "作战态势概览" });
  addPath(paths, "/dashboard/stats", "get", { tags: ["仪表盘"], summary: "统计数据" });

  // Import/Export
  addPath(paths, "/import", "post", { tags: ["导入导出"], summary: "导入 Excel" });
  addPath(paths, "/export/{nodeType}", "get", {
    tags: ["导入导出"],
    summary: "导出 Excel",
    parameters: pathParam("nodeType", "节点类型"),
  });
  addPath(paths, "/backup", "get", { tags: ["导入导出"], summary: "备份数据库" });
  addPath(paths, "/backup/restore", "post", { tags: ["导入导出"], summary: "恢复数据库" });

  // Email
  addPath(paths, "/email/config", "get", { tags: ["邮件"], summary: "获取 SMTP 配置", security: bearer() });
  addPath(paths, "/email/config", "put", { tags: ["邮件"], summary: "更新 SMTP 配置", security: bearer() });
  addPath(paths, "/email/send", "post", { tags: ["邮件"], summary: "发送测试邮件", security: bearer() });

  // Webhook
  addPath(paths, "/webhooks", "get", { tags: ["邮件"], summary: "Webhook 列表", security: bearer() });
  addPath(paths, "/webhooks", "post", { tags: ["邮件"], summary: "创建 Webhook", security: bearer() });
  addPath(paths, "/webhooks/{id}", "delete", {
    tags: ["邮件"],
    summary: "删除 Webhook",
    security: bearer(),
    parameters: pathParam("id", "Webhook ID"),
  });

  // Digest
  addPath(paths, "/digest/config", "get", { tags: ["邮件"], summary: "邮件摘要配置", security: bearer() });
  addPath(paths, "/digest/preview", "get", { tags: ["邮件"], summary: "预览摘要", security: bearer() });
  addPath(paths, "/digest/send", "post", { tags: ["邮件"], summary: "手动发送摘要", security: bearer() });

  // Hermes/AI
  addPath(paths, "/hermes/ask", "post", { tags: ["AI"], summary: "Hermes 问答" });
  addPath(paths, "/hermes/models", "get", { tags: ["AI"], summary: "可用模型列表" });
  addPath(paths, "/llm-settings", "get", { tags: ["AI"], summary: "LLM 配置（admin）", security: bearer() });

  // Invitations
  addPath(paths, "/invitations", "get", { tags: ["邀请管理"], summary: "邀请列表", security: bearer() });
  addPath(paths, "/invitations", "post", { tags: ["邀请管理"], summary: "创建邀请", security: bearer() });
  addPath(paths, "/invitations/check/{code}", "get", {
    tags: ["邀请管理"],
    summary: "验证邀请码",
    parameters: pathParam("code", "邀请码"),
  });

  // Wiki
  addPath(paths, "/wiki", "get", { tags: ["知识库"], summary: "知识库文章列表" });
  addPath(paths, "/wiki", "post", { tags: ["知识库"], summary: "创建文章", security: bearer() });
  addPath(paths, "/wiki/{id}", "get", { tags: ["知识库"], summary: "文章详情", parameters: pathParam("id", "文章ID") });
  addPath(paths, "/wiki/{id}", "put", {
    tags: ["知识库"],
    summary: "更新文章",
    security: bearer(),
    parameters: pathParam("id", "文章ID"),
  });
  addPath(paths, "/wiki/{id}", "delete", {
    tags: ["知识库"],
    summary: "删除文章",
    security: bearer(),
    parameters: pathParam("id", "文章ID"),
  });
  addPath(paths, "/wiki/reorder", "post", { tags: ["知识库"], summary: "重排序", security: bearer() });

  // System
  addPath(paths, "/audit", "get", { tags: ["系统管理"], summary: "审计日志", security: bearer() });
  addPath(paths, "/settings", "get", { tags: ["系统管理"], summary: "配置中心列表", security: bearer() });
  addPath(paths, "/settings", "put", { tags: ["系统管理"], summary: "更新配置", security: bearer() });
  addPath(paths, "/op-logs", "get", { tags: ["系统管理"], summary: "操作日志", security: bearer() });
  addPath(paths, "/health", "get", { tags: ["系统管理"], summary: "健康检查" });
  addPath(paths, "/metrics", "get", { tags: ["系统管理"], summary: "Prometheus 指标" });

  // Ticket Tabs
  addPath(paths, "/tickets/{id}/tabs", "get", {
    tags: ["节点CRUD"],
    summary: "获取攻关单自定义标签",
    parameters: pathParam("id", "攻关单ID"),
  });
  addPath(paths, "/tickets/{id}/tabs", "post", {
    tags: ["节点CRUD"],
    summary: "创建自定义标签",
    parameters: pathParam("id", "攻关单ID"),
  });

  return spec;
}

function addPath(
  paths: Record<string, Record<string, unknown>>,
  path: string,
  method: string,
  op: Record<string, unknown>
) {
  if (!paths[path]) paths[path] = {};
  paths[path][method] = op;
}

function pathParam(name: string, desc: string): Record<string, unknown> {
  return { name, in: "path", required: true, description: desc, schema: { type: "string" } };
}

function bearer(): Record<string, unknown>[] {
  return [{ bearerAuth: [] }];
}

function ref($ref: string): Record<string, unknown> {
  return { $ref };
}

function swaggerUiHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>作战管理平台 API 文档</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: "/api/openapi.json",
      dom_id: '#swagger-ui',
      presets: [
        SwaggerUIBundle.presets.apis,
        SwaggerUIBundle.SwaggerUIStandalonePreset
      ],
      layout: "BaseLayout",
      tryItOutEnabled: true,
      requestInterceptor: function(req) {
        var token = localStorage.getItem('combat-token');
        if (token) req.headers['Authorization'] = 'Bearer ' + token;
        return req;
      }
    });
  </script>
</body>
</html>`;
}
