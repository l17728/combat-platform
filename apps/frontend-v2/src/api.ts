import type {
  GraphNode,
  GraphSnapshot,
  ProgressLog,
  NodeSchema,
  FieldSchema,
  FieldOp,
  LeaderboardEntry,
  PersonHonor,
  HelperRecommendation,
  DashboardSummary,
  AuditLogEntry,
  MergePreview,
  TransitionResult,
  ImportPreview,
  SmtpConfig,
  SmtpConfigMasked,
  EmailSendRequest,
  EmailSendResult,
  DailyReport,
  RelatedItem,
  CoAnchoredItem,
  ExpandedItem,
  ConflictItem,
} from "@combat/shared";

export interface RelatedResult {
  outgoing: RelatedItem[];
  incoming: RelatedItem[];
  candidates?: { proposalId: string; relationType: string; confidence: number; rationale: string; node: GraphNode }[];
  coAnchored?: CoAnchoredItem[];
  expanded?: ExpandedItem[];
  conflicts?: ConflictItem[];
  manualLinks?: { edgeId: string; note: string; target: GraphNode }[];
}

export interface DailyReportEntry {
  id: string;
  ticketId: string;
  type: string;
  currentProgress: string;
  nextSteps: string;
  status: "草稿" | "已发布";
  createdBy: string;
  createdAt: string;
  publishedAt: string | null;
}

export interface SupportNode {
  id: string;
  ticketId: string | null;
  templateId: string | null;
  parentId: string | null;
  category: string;
  domain: string;
  personId: string | null;
  personName: string | null;
  status: string;
  note: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface SupportTemplate {
  id: string;
  name: string;
  description: string;
  usageCount: number;
  createdAt: string;
}

export interface SchemaSuggestion {
  nodeType: string;
  fieldId: string;
  fieldName: string;
  label: string;
  type: string;
  concept?: string;
  anchor?: string;
  matchReason: string;
}

export interface TeamLeaderboardEntry {
  team: string;
  score: number;
  贡献数: number;
}

export interface RelationProposal {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationType: string;
  confidence: number;
  proposerSource: string;
  rationale: string;
  status: "待审批" | "已通过" | "已拒绝";
  decidedBy?: string;
  decidedAt?: string;
  createdAt: string;
}

export interface Reminder {
  id: string;
  kind: string;
  ticketId: string;
  recipientPersonId?: string;
  recipientName: string;
  subject: string;
  body: string;
  status: "待发送" | "已发送" | "已忽略";
  decidedBy?: string;
  decidedAt?: string;
  createdAt: string;
}

export interface WelinkAttachment {
  type?: string;
  url?: string;
  name?: string;
}

export interface WelinkUploadMessage {
  messageId: string;
  sentAt: string;
  author: string;
  authorId?: string;
  content: string;
  attachments?: WelinkAttachment[];
  raw?: unknown;
}

export interface WelinkImage {
  filename?: string;
  url?: string;
  width?: number;
  height?: number;
  size?: number;
  md5?: string;
}

export interface WelinkCardContext {
  preMsg?: { content?: string; nameZH?: string; sender?: string };
  replyMsg?: { content?: string };
}

export interface WelinkContentJson {
  cardType?: number;
  cardContext?: WelinkCardContext;
  [k: string]: unknown;
}

export interface WelinkMessage {
  id: string;
  ticketId: string;
  messageId: string;
  sentAt: string;
  author: string;
  authorId: string | null;
  content: string;
  contentType: string;
  contentJson: WelinkContentJson | null;
  images: WelinkImage[];
  attachments: WelinkAttachment[];
  raw: string | null;
  selected: boolean;
  deletedAt: string | null;
  createdAt: string;
}

export type WelinkExtractionKind = "entity" | "event" | "decision" | "dispute" | "gap";

export interface WelinkExtraction {
  id: string;
  ticketId: string;
  kind: WelinkExtractionKind;
  label: string;
  payload: any;
  sourceMsgIds: string[];
  createdAt: string;
  createdBy: string | null;
  reviewed: boolean;
}

export interface WelinkAnalyzeResult {
  ok: boolean;
  queued: number;
  extracted: number;
  source: "agent" | "heuristic" | "agent+heuristic" | "noop";
  extractions: WelinkExtraction[];
  message?: string;
}

export interface WelinkGapSender {
  name: string;
  senderId: string;
  appearedCount: number;
  suggestion: string;
}

export interface WelinkGapAnalysis {
  ticketId: string;
  welinkActiveSenders: string[];
  welinkActiveNames: string[];
  ticketMembers: { 姓名: string; 角色: string }[];
  gap: WelinkGapSender[];
}

export interface QueryContext {
  node: GraphNode;
  related: {
    outgoing: RelatedItem[];
    incoming: RelatedItem[];
    coAnchored: CoAnchoredItem[];
  };
  progress: ProgressLog[];
}

/**
 * 类型化的 API 错误。所有 api.* 调用失败统一抛 ApiError(而非裸 Error),
 * 调用方可以按 status 分支处理(如 403 隐藏 toast)。
 *
 * 渐进迁移:旧 catch (e: any) { message.error(e.message) } 仍兼容(message 字段保留);
 * 新代码推荐 catch (e) { handleApiError(e, '操作失败') }。
 */
export class ApiError extends Error {
  status: number;
  detail?: string;
  path: string;

  constructor(status: number, message: string, path: string, detail?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.path = path;
  }
}

// 401 全局回调。在 main.tsx 注册一次,触发即跳 /login。
// 拆出来便于测试(测试时可注册 noop)。
let unauthorizedHandler: ((err: ApiError) => void) | null = null;
export function onUnauthorized(handler: (err: ApiError) => void): void {
  unauthorizedHandler = handler;
}
export function _triggerUnauthorized(err: ApiError): void {
  if (unauthorizedHandler) unauthorizedHandler(err);
}

export class Api {
  private f: typeof fetch;
  constructor(
    private base = "",
    f?: typeof fetch
  ) {
    this.f = f ?? globalThis.fetch.bind(globalThis);
    if (!this.base) {
      this.base = "";
    }
  }

  private getToken(): string | null {
    try {
      return localStorage.getItem("combat-token");
    } catch {
      return null;
    }
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { ...((init.headers as Record<string, string>) ?? {}) };
    const token = this.getToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    // P0-3 修复:不再注入 X-Role 头,后端从 JWT payload 取 role,
    // 防止客户端伪造 role 越权(localStorage 可任意改写)。
    init = { ...init, headers };
    const start = Date.now();
    const r = await this.f(`${this.base}${path}`, init);
    const duration = Date.now() - start;
    try {
      const { logApiCall } = await import("./utils/op-logger.js");
      logApiCall(init.method || "GET", path, r.status, duration, r.ok ? undefined : `HTTP ${r.status}`);
    } catch {}
    if (!r.ok) {
      const body = await r.json().catch(() => null);
      const detail = body?.error ?? (Array.isArray(body?.errors) ? body.errors.join("; ") : "");
      const msg = `HTTP ${r.status}${detail ? ` ${detail}` : ` ${r.url || path}`}`;
      const err = new ApiError(r.status, msg, path, detail || undefined);
      // 401:未登录或 token 过期 → 全局跳登录。/api/auth/me 是 AuthProvider 启动时探活
      // 用的,不能让它弹 toast + 跳转(它的 401 是预期的"未登录"信号),所以排除。
      if (r.status === 401 && !path.startsWith("/api/auth/me")) {
        _triggerUnauthorized(err);
      }
      throw err;
    }
    const ct = r.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) return r.json() as Promise<T>;
    const txt = await r.text();
    try {
      return JSON.parse(txt) as T;
    } catch {
      return txt as unknown as T;
    }
  }

  listNodes(nodeType: string, filter: Record<string, string> = {}): Promise<GraphNode[]> {
    const qs = new URLSearchParams(filter).toString();
    return this.req<GraphNode[]>(`/api/nodes/${nodeType}${qs ? "?" + qs : ""}`);
  }

  getNode(id: string): Promise<GraphNode> {
    return this.req<GraphNode>(`/api/nodes/${id}`);
  }

  getSchema(nodeType: string): Promise<NodeSchema> {
    return this.req<NodeSchema>(`/api/schema/${nodeType}`);
  }

  createNode(nodeType: string, props: Record<string, unknown>): Promise<GraphNode> {
    return this.req<GraphNode>(`/api/nodes/${nodeType}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(props),
    });
  }

  updateNode(id: string, props: Record<string, unknown>): Promise<GraphNode> {
    return this.req<GraphNode>(`/api/nodes/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(props),
    });
  }

  deleteNode(id: string): Promise<{ ok: boolean }> {
    return this.req<{ ok: boolean }>(`/api/nodes/${id}`, { method: "DELETE" });
  }

  listProgress(id: string): Promise<ProgressLog[]> {
    return this.req<ProgressLog[]>(`/api/nodes/${id}/progress`);
  }

  appendProgress(id: string, content: string, statusSnapshot: string): Promise<ProgressLog> {
    return this.req<ProgressLog>(`/api/nodes/${id}/progress`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content, statusSnapshot, actor: "ui" }),
    });
  }

  transition(id: string, toStatus: string, note?: string): Promise<TransitionResult> {
    return this.req<TransitionResult>(`/api/nodes/${id}/transition`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toStatus, note }),
    });
  }

  recommendHelpers(id: string, limit?: number): Promise<HelperRecommendation[]> {
    const qs = limit ? `?limit=${limit}` : "";
    return this.req<HelperRecommendation[]>(`/api/recommend/helpers/${id}${qs}`);
  }

  getDashboard(): Promise<DashboardSummary> {
    return this.req<DashboardSummary>("/api/dashboard");
  }

  getLeaderboard(period?: string): Promise<LeaderboardEntry[]> {
    const qs = period ? `?period=${encodeURIComponent(period)}` : "";
    return this.req<LeaderboardEntry[]>(`/api/honor/leaderboard${qs}`);
  }

  getPersonHonor(name: string): Promise<PersonHonor> {
    return this.req<PersonHonor>(`/api/honor/person/${encodeURIComponent(name)}`);
  }

  listAudit(
    filter: {
      action?: string;
      entityType?: string;
      entityId?: string;
      limit?: number;
    } = {}
  ): Promise<AuditLogEntry[]> {
    const p = new URLSearchParams();
    if (filter.action) p.set("action", filter.action);
    if (filter.entityType) p.set("entityType", filter.entityType);
    if (filter.entityId) p.set("entityId", filter.entityId);
    if (filter.limit) p.set("limit", String(filter.limit));
    const qs = p.toString();
    return this.req<AuditLogEntry[]>(`/api/audit${qs ? "?" + qs : ""}`);
  }

  mergePreview(fromId: string, toId: string): Promise<MergePreview> {
    return this.req<MergePreview>(
      `/api/merge/preview?fromId=${encodeURIComponent(fromId)}&toId=${encodeURIComponent(toId)}`
    );
  }

  mergePerson(fromId: string, toId: string): Promise<GraphNode> {
    return this.req<GraphNode>("/api/merge/person", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fromId, toId }),
    });
  }

  importXlsx(
    file: File,
    type?: string,
    createFields?: boolean
  ): Promise<{ created: number; updated: number; skipped?: number; createdFields?: string[] }> {
    const fd = new FormData();
    fd.append("file", file);
    const p = new URLSearchParams();
    if (type) p.set("type", type);
    if (createFields) p.set("createFields", "1");
    const qs = p.toString();
    return this.req(`/api/import${qs ? `?${qs}` : ""}`, { method: "POST", body: fd });
  }

  importPreview(file: File, type?: string): Promise<ImportPreview> {
    const fd = new FormData();
    fd.append("file", file);
    const p = new URLSearchParams({ dryRun: "1" });
    if (type) p.set("type", type);
    return this.req<ImportPreview>(`/api/import?${p.toString()}`, { method: "POST", body: fd });
  }

  kgGraph(opts?: { types?: string[]; q?: string; limit?: number }): Promise<GraphSnapshot> {
    const p = new URLSearchParams();
    if (opts?.types?.length) p.set("types", opts.types.join(","));
    if (opts?.q) p.set("q", opts.q);
    if (opts?.limit) p.set("limit", String(opts.limit));
    const qs = p.toString();
    return this.req<GraphSnapshot>(`/api/kg/graph${qs ? `?${qs}` : ""}`);
  }

  graphSnapshot(nodeType: string, id: string, depth = 1): Promise<GraphSnapshot> {
    return this.req<GraphSnapshot>(`/api/graph/snapshot/${nodeType}/${id}?depth=${depth}`);
  }

  listDocuments(): Promise<DocItem[]> {
    return this.req<DocItem[]>("/api/documents");
  }
  uploadDocument(file: File, name?: string, uploadedBy?: string): Promise<DocItem> {
    const fd = new FormData();
    fd.append("file", file);
    if (name) fd.append("name", name);
    if (uploadedBy) fd.append("uploadedBy", uploadedBy);
    return this.req<DocItem>("/api/documents", { method: "POST", body: fd });
  }
  addDocumentLink(name: string, url: string, uploadedBy?: string): Promise<DocItem> {
    return this.req<DocItem>("/api/documents/link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, url, uploadedBy }),
    });
  }
  deleteDocument(id: string): Promise<{ ok: boolean }> {
    return this.req(`/api/documents/${id}`, { method: "DELETE" });
  }

  private async authFetch(path: string): Promise<Response> {
    const headers: Record<string, string> = {};
    const token = this.getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    // P0-3 修复:不再注入 X-Role 头(role 由 JWT 携带)。
    return this.f(`${this.base}${path}`, { headers });
  }

  exportNodes(nodeType: string): Promise<Blob> {
    return this.authFetch(`/api/export/${nodeType}`).then((r) => {
      if (!r.ok) throw new Error(`导出失败: HTTP ${r.status}`);
      return r.blob();
    });
  }

  getEmailConfig(): Promise<SmtpConfigMasked> {
    return this.req<SmtpConfigMasked>("/api/email/config");
  }

  putEmailConfig(cfg: Partial<SmtpConfig>): Promise<SmtpConfigMasked> {
    return this.req<SmtpConfigMasked>("/api/email/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cfg),
    });
  }

  testEmail(to: string): Promise<EmailSendResult> {
    return this.req<EmailSendResult>("/api/email/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to }),
    });
  }

  sendEmail(req: EmailSendRequest): Promise<EmailSendResult> {
    return this.req<EmailSendResult>("/api/email/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
  }

  patchSchema(nodeType: string, op: FieldOp): Promise<NodeSchema> {
    return this.req<NodeSchema>(`/api/schema/${nodeType}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(op),
    });
  }

  createHelpRequest(params: {
    ticketId: string;
    requesterName: string;
    targetName?: string;
    targetEmail: string;
    category: string;
    question: string;
    extraNote?: string;
  }): Promise<HelpRequest> {
    return this.req<HelpRequest>("/api/help-requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
  }

  listHelpRequests(params?: { ticketId?: string; status?: string }): Promise<HelpRequest[]> {
    const p = new URLSearchParams();
    if (params?.ticketId) p.set("ticketId", params.ticketId);
    if (params?.status) p.set("status", params.status);
    const qs = p.toString();
    return this.req<HelpRequest[]>(`/api/help-requests${qs ? "?" + qs : ""}`);
  }

  getHelpFeedback(token: string): Promise<{
    ticketTitle: string;
    requesterName: string;
    question: string;
    category: string;
    status: string;
  }> {
    return this.req(`/api/help/feedback/${token}`);
  }

  submitHelpFeedback(token: string, feedback: string, name?: string): Promise<HelpRequest> {
    return this.req<HelpRequest>(`/api/help/feedback/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feedback, name }),
    });
  }

  getRelated(
    nodeType: string,
    id: string,
    opts?: { includeCandidates?: boolean; depth?: number }
  ): Promise<RelatedResult> {
    const p = new URLSearchParams();
    if (opts?.includeCandidates) p.set("includeCandidates", "1");
    if (opts?.depth) p.set("depth", String(opts.depth));
    const qs = p.toString();
    return this.req<RelatedResult>(`/api/related/${nodeType}/${id}${qs ? "?" + qs : ""}`);
  }

  getDailyReport(date: string): Promise<DailyReport> {
    return this.req<DailyReport>(`/api/daily-report?date=${encodeURIComponent(date)}`);
  }

  publishDailyReport(date: string): Promise<{ date: string; ticketsTouched: number; published: number }> {
    return this.req("/api/daily-report/publish?date=" + encodeURIComponent(date), { method: "POST" });
  }

  listDailyReportEntries(ticketId: string): Promise<DailyReportEntry[]> {
    return this.req<DailyReportEntry[]>(`/api/nodes/${ticketId}/daily-reports`);
  }

  createDailyReportEntry(
    ticketId: string,
    data: { type: string; currentProgress: string; nextSteps?: string }
  ): Promise<DailyReportEntry> {
    return this.req<DailyReportEntry>(`/api/nodes/${ticketId}/daily-reports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  updateDailyReportEntry(
    ticketId: string,
    entryId: string,
    data: { type?: string; currentProgress?: string; nextSteps?: string }
  ): Promise<DailyReportEntry> {
    return this.req<DailyReportEntry>(`/api/nodes/${ticketId}/daily-reports/${entryId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  publishDailyReportEntry(ticketId: string, entryId: string): Promise<DailyReportEntry> {
    return this.req<DailyReportEntry>(`/api/nodes/${ticketId}/daily-reports/${entryId}/publish`, { method: "POST" });
  }

  deleteDailyReportEntry(ticketId: string, entryId: string): Promise<void> {
    return this.req(`/api/nodes/${ticketId}/daily-reports/${entryId}`, { method: "DELETE" });
  }

  listSupportNodes(ticketId: string): Promise<SupportNode[]> {
    return this.req<SupportNode[]>(`/api/support-nodes/${ticketId}`);
  }

  createSupportNode(ticketId: string, data: Partial<SupportNode>): Promise<SupportNode> {
    return this.req<SupportNode>(`/api/support-nodes/${ticketId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  updateSupportNode(nodeId: string, data: Partial<SupportNode>): Promise<SupportNode> {
    return this.req<SupportNode>(`/api/support-nodes/node/${nodeId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  deleteSupportNode(nodeId: string): Promise<{ deleted: number }> {
    return this.req(`/api/support-nodes/node/${nodeId}`, { method: "DELETE" });
  }

  listSupportTemplates(): Promise<SupportTemplate[]> {
    return this.req<SupportTemplate[]>("/api/support-templates");
  }

  applySupportTemplate(templateId: string, ticketId: string): Promise<{ applied: number; nodes: SupportNode[] }> {
    return this.req(`/api/support-templates/${templateId}/apply/${ticketId}`, { method: "POST" });
  }

  listSchemas(): Promise<NodeSchema[]> {
    return this.req<NodeSchema[]>("/api/schema/list");
  }

  createSchema(data: {
    nodeType: string;
    label: string;
    fields: FieldSchema[];
    identityKeys?: string[];
  }): Promise<NodeSchema> {
    return this.req<NodeSchema>("/api/schema/nodeType", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  deleteSchema(nodeType: string): Promise<{ ok: boolean }> {
    return this.req(`/api/schema/nodeType/${nodeType}`, { method: "DELETE" });
  }

  suggestSchema(q: string): Promise<SchemaSuggestion[]> {
    return this.req<SchemaSuggestion[]>(`/api/schema/suggest?q=${encodeURIComponent(q)}`);
  }

  getTeamLeaderboard(period?: string): Promise<TeamLeaderboardEntry[]> {
    const qs = period ? `?period=${encodeURIComponent(period)}&groupBy=team` : "?groupBy=team";
    return this.req<TeamLeaderboardEntry[]>(`/api/honor/leaderboard${qs}`);
  }

  searchNodes(
    q: string,
    type?: string,
    limit?: number
  ): Promise<{ id: string; nodeType: string; summary: string; score: number }[]> {
    const p = new URLSearchParams({ q });
    if (type) p.set("type", type);
    if (limit) p.set("limit", String(limit));
    return this.req(`/api/query/search?${p.toString()}`);
  }

  hermesAsk(
    question: string,
    context?: string
  ): Promise<{
    question: string;
    intent: string;
    answer: string;
    citations: { nodeId: string; nodeType: string; summary: string; link: string }[];
    uiSpec?: any;
  }> {
    return this.req("/api/hermes/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(context ? { question, context } : { question }),
    });
  }

  listSettings(): Promise<Record<string, { values: string[]; label?: string }>> {
    return this.req("/api/settings");
  }

  getSetting(key: string): Promise<{ values: string[]; label?: string }> {
    return this.req(`/api/settings/${encodeURIComponent(key)}`);
  }

  resolveSetting(key: string, scope?: string): Promise<{ values: string[]; label?: string }> {
    const p = scope ? `?scope=${encodeURIComponent(scope)}` : "";
    return this.req(`/api/settings/${encodeURIComponent(key)}/resolve${p}`);
  }

  setSetting(
    key: string,
    values: string[],
    label?: string
  ): Promise<{ key: string; values: string[]; label?: string }> {
    return this.req(`/api/settings/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ values, label }),
    });
  }

  deleteSetting(key: string): Promise<{ deleted: string }> {
    return this.req(`/api/settings/${encodeURIComponent(key)}`, { method: "DELETE" });
  }

  scanProposals(): Promise<{ created: number }> {
    return this.req("/api/proposals/scan", { method: "POST" });
  }

  listProposals(status?: string): Promise<RelationProposal[]> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.req<RelationProposal[]>(`/api/proposals${qs}`);
  }

  decideProposal(
    id: string,
    decision: string,
    decidedBy: string,
    patch?: { targetNodeId: string }
  ): Promise<RelationProposal> {
    return this.req<RelationProposal>(`/api/proposals/${id}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, decidedBy, patch }),
    });
  }

  scanReminders(): Promise<{ created: number }> {
    return this.req("/api/reminders/scan", { method: "POST" });
  }

  listReminders(status?: string): Promise<Reminder[]> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.req<Reminder[]>(`/api/reminders${qs}`);
  }

  sendReminder(id: string, decidedBy: string): Promise<Reminder> {
    return this.req<Reminder>(`/api/reminders/${id}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decidedBy }),
    });
  }

  ignoreReminder(id: string, decidedBy: string): Promise<Reminder> {
    return this.req<Reminder>(`/api/reminders/${id}/ignore`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decidedBy }),
    });
  }

  getContext(id: string): Promise<QueryContext> {
    return this.req<QueryContext>(`/api/query/context/${id}`);
  }

  createBugReport(data: {
    title: string;
    description?: string;
    severity?: string;
    pageUrl?: string;
    reporter?: string;
    screenshot?: string;
    consoleLogs?: string;
    userAgent?: string;
  }): Promise<any> {
    return this.req("/api/bug-reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  listBugReports(status?: string): Promise<any[]> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.req(`/api/bug-reports${qs}`);
  }

  getBugReport(id: string): Promise<any> {
    return this.req(`/api/bug-reports/${id}`);
  }

  updateBugReport(
    id: string,
    data: {
      status?: string;
      resolution?: string;
      resolvedBy?: string;
      title?: string;
      description?: string;
      severity?: string;
      pageUrl?: string;
      reporter?: string;
    }
  ): Promise<any> {
    return this.req(`/api/bug-reports/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  deleteBugReport(id: string): Promise<{ deleted: string }> {
    return this.req(`/api/bug-reports/${id}`, { method: "DELETE" });
  }

  login(username: string, password: string): Promise<LoginResult> {
    return this.req("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  }

  register(username: string, password: string, displayName?: string, role?: string): Promise<LoginResult> {
    return this.req("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, displayName, role }),
    });
  }

  getMe(): Promise<{ user: AuthUser; passwordMustChange?: boolean }> {
    return this.req("/api/auth/me");
  }

  changePassword(oldPassword: string, newPassword: string): Promise<{ ok: boolean }> {
    return this.req("/api/auth/change-password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPassword, newPassword }),
    });
  }

  listUsers(): Promise<AuthUser[]> {
    return this.req("/api/users");
  }

  createUser(data: { username: string; password: string; displayName?: string; role?: string }): Promise<AuthUser> {
    return this.req("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  updateUser(id: string, data: { role?: string; displayName?: string; password?: string }): Promise<AuthUser> {
    return this.req(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  deleteUser(id: string): Promise<{ ok: boolean }> {
    return this.req(`/api/users/${id}`, { method: "DELETE" });
  }

  listOpLogs(params?: {
    sessionId?: string;
    userName?: string;
    category?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ total: number; rows: OpLogEntry[] }> {
    const p = new URLSearchParams();
    if (params?.sessionId) p.set("sessionId", params.sessionId);
    if (params?.userName) p.set("userName", params.userName);
    if (params?.category) p.set("category", params.category);
    if (params?.from) p.set("from", params.from);
    if (params?.to) p.set("to", params.to);
    if (params?.limit) p.set("limit", String(params.limit));
    if (params?.offset) p.set("offset", String(params.offset));
    const qs = p.toString();
    return this.req(`/api/op-logs${qs ? "?" + qs : ""}`);
  }

  deleteOpLogs(params: { before?: string; sessionId?: string }): Promise<{ deleted: number }> {
    const p = new URLSearchParams();
    if (params.before) p.set("before", params.before);
    if (params.sessionId) p.set("sessionId", params.sessionId);
    const qs = p.toString();
    return this.req(`/api/op-logs?${qs}`, { method: "DELETE" });
  }

  getOpLogSettings(): Promise<{ enabled: boolean }> {
    return this.req("/api/op-logs/settings");
  }

  setOpLogSettings(enabled: boolean): Promise<{ enabled: boolean }> {
    return this.req("/api/op-logs/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
  }

  listBackups(): Promise<BackupInfo[]> {
    return this.req("/api/backup");
  }

  createBackup(): Promise<{ filename: string; size: number }> {
    return this.req("/api/backup", { method: "POST" });
  }

  downloadBackup(filename: string): Promise<Blob> {
    return this.authFetch(`/api/backup/${encodeURIComponent(filename)}`).then((r) => {
      if (!r.ok) throw new Error(`下载失败: HTTP ${r.status}`);
      return r.blob();
    });
  }

  deleteBackup(filename: string): Promise<{ deleted: string }> {
    return this.req(`/api/backup/${encodeURIComponent(filename)}`, { method: "DELETE" });
  }

  restoreBackup(file: File): Promise<{ restored: boolean; message: string }> {
    const fd = new FormData();
    fd.append("file", file);
    return this.req("/api/backup/restore", { method: "POST", body: fd });
  }

  getBackupSchedule(): Promise<BackupSchedule> {
    return this.req("/api/backup/schedule");
  }

  setBackupSchedule(cfg: Partial<BackupSchedule>): Promise<BackupSchedule> {
    return this.req("/api/backup/schedule", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cfg),
    });
  }

  listTicketTabs(ticketId: string): Promise<TicketTab[]> {
    return this.req<TicketTab[]>(`/api/tickets/${encodeURIComponent(ticketId)}/tabs`);
  }

  createTicketTab(
    ticketId: string,
    data: { tabType: string; title: string; config?: any; content?: string }
  ): Promise<TicketTab> {
    return this.req<TicketTab>(`/api/tickets/${encodeURIComponent(ticketId)}/tabs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  updateTicketTab(
    ticketId: string,
    tabId: string,
    data: { title?: string; config?: any; content?: string }
  ): Promise<TicketTab> {
    return this.req<TicketTab>(`/api/tickets/${encodeURIComponent(ticketId)}/tabs/${encodeURIComponent(tabId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  deleteTicketTab(ticketId: string, tabId: string): Promise<{ deleted: string }> {
    return this.req(`/api/tickets/${encodeURIComponent(ticketId)}/tabs/${encodeURIComponent(tabId)}`, {
      method: "DELETE",
    });
  }

  reorderTicketTabs(ticketId: string, order: string[]): Promise<{ ok: boolean }> {
    return this.req(`/api/tickets/${encodeURIComponent(ticketId)}/tabs/order`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ order }),
    });
  }

  uploadWelinkMessages(
    ticketId: string,
    messages: WelinkUploadMessage[]
  ): Promise<{ inserted: number; updated: number; total: number }> {
    return this.req(`/api/tickets/${encodeURIComponent(ticketId)}/welink-messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages }),
    });
  }

  listWelinkMessages(
    ticketId: string,
    filter: {
      author?: string;
      since?: string;
      until?: string;
      keyword?: string;
      includeDeleted?: boolean;
      offset?: number;
      limit?: number;
    } = {}
  ): Promise<{ messages: WelinkMessage[]; stats: { total: number; selected: number; deleted: number } }> {
    const p = new URLSearchParams();
    if (filter.author) p.set("author", filter.author);
    if (filter.since) p.set("since", filter.since);
    if (filter.until) p.set("until", filter.until);
    if (filter.keyword) p.set("keyword", filter.keyword);
    if (filter.includeDeleted) p.set("includeDeleted", "true");
    if (filter.offset !== undefined) p.set("offset", String(filter.offset));
    if (filter.limit !== undefined) p.set("limit", String(filter.limit));
    const qs = p.toString();
    return this.req(`/api/tickets/${encodeURIComponent(ticketId)}/welink-messages${qs ? "?" + qs : ""}`);
  }

  deleteAllWelinkMessages(ticketId: string): Promise<{ deleted: number }> {
    return this.req(`/api/tickets/${encodeURIComponent(ticketId)}/welink-messages`, { method: "DELETE" });
  }

  deleteWelinkMessage(ticketId: string, messageIdOrId: string): Promise<{ deleted: number }> {
    return this.req(
      `/api/tickets/${encodeURIComponent(ticketId)}/welink-messages/${encodeURIComponent(messageIdOrId)}`,
      { method: "DELETE" }
    );
  }

  batchDeleteWelinkMessages(ticketId: string, ids: string[]): Promise<{ deleted: number }> {
    return this.req(`/api/tickets/${encodeURIComponent(ticketId)}/welink-messages/batch-delete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });
  }

  updateWelinkSelection(
    ticketId: string,
    ids: string[],
    selected: boolean
  ): Promise<{ updated: number; selected: boolean }> {
    return this.req(`/api/tickets/${encodeURIComponent(ticketId)}/welink-messages/selection`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids, selected }),
    });
  }

  analyzeWelinkMessages(ticketId: string): Promise<WelinkAnalyzeResult> {
    return this.req(`/api/tickets/${encodeURIComponent(ticketId)}/welink-messages/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
  }

  listWelinkExtractions(
    ticketId: string,
    opts?: { kind?: string; reviewed?: boolean }
  ): Promise<{ items: WelinkExtraction[] }> {
    const p = new URLSearchParams();
    if (opts?.kind) p.set("kind", opts.kind);
    if (opts?.reviewed != null) p.set("reviewed", String(opts.reviewed));
    const qs = p.toString();
    return this.req(`/api/tickets/${encodeURIComponent(ticketId)}/welink-extractions${qs ? "?" + qs : ""}`);
  }

  updateWelinkExtraction(
    ticketId: string,
    extId: string,
    patch: { reviewed?: boolean; label?: string; payload?: unknown }
  ): Promise<WelinkExtraction> {
    return this.req(`/api/tickets/${encodeURIComponent(ticketId)}/welink-extractions/${encodeURIComponent(extId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  deleteWelinkExtraction(ticketId: string, extId: string): Promise<{ ok: boolean }> {
    return this.req(`/api/tickets/${encodeURIComponent(ticketId)}/welink-extractions/${encodeURIComponent(extId)}`, {
      method: "DELETE",
    });
  }

  welinkGapAnalysis(ticketId: string): Promise<WelinkGapAnalysis> {
    return this.req(`/api/tickets/${encodeURIComponent(ticketId)}/welink/gap-analysis`);
  }

  welinkAddMembers(
    ticketId: string,
    names: string[],
    role?: "组长" | "组员"
  ): Promise<{ ok: boolean; added: number; members: { 姓名: string; 角色: string }[] }> {
    return this.req(`/api/tickets/${encodeURIComponent(ticketId)}/welink/add-members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ names, role }),
    });
  }

  // 数据库迁移 (Phase 3.5 / task #68)
  dbMigrationStatus(): Promise<{
    kind: "sqlite" | "postgres";
    url: string;
    tables: { name: string; rows: number }[];
    lastMigratedAt?: string | null;
  }> {
    return this.req("/api/db-migration/status");
  }

  dbMigrationTestConnection(pgUrl: string): Promise<{ ok: boolean }> {
    return this.req("/api/db-migration/test-connection", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pgUrl }),
    });
  }

  async dbMigrationRun(opts: {
    pgUrl: string;
    truncate?: boolean;
    dryRun?: boolean;
    onProgress?: (percent: number) => void;
  }): Promise<{ ok: boolean; stats: Record<string, { source: number; copied: number }>; error?: string }> {
    // 单次 POST 调用,后端阻塞返回结果(实现简单);若需要实时进度,后端改 SSE,前端这里换 EventSource。
    const r = await this.req<{ ok: boolean; stats: any; error?: string }>("/api/db-migration/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pgUrl: opts.pgUrl, truncate: !!opts.truncate, dryRun: !!opts.dryRun }),
    });
    opts.onProgress?.(100);
    return r;
  }

  // 一键升级 (v2.3 / task #75)
  upgradeCurrent(): Promise<{
    version: string;
    commit: string | null;
    readableVersion: string;
    uptimeSec: number;
    dbBytes: number;
    userFieldCount: number;
  }> {
    return this.req("/api/upgrade/current");
  }

  upgradeUpload(file: File): Promise<{ stagingId: string; size: number; name: string }> {
    const fd = new FormData();
    fd.append("file", file);
    return this.req("/api/upgrade/upload", { method: "POST", body: fd });
  }

  upgradeAnalyze(stagingId: string): Promise<{
    stagingId: string;
    targetVersion: string;
    schemaReport: {
      kept: { nodeType: string; fieldName: string }[];
      conflicts: {
        nodeType: string;
        fieldName: string;
        baselineType?: string;
        userType?: string;
        suggestion: string;
      }[];
      removed: unknown[];
      userTables: { nodeType: string; fieldCount: number }[];
    };
    breaking: string[];
    newSchemas: string[];
    requiredEnv: string[];
    warnings: string[];
  }> {
    return this.req("/api/upgrade/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stagingId }),
    });
  }

  upgradeApply(stagingId: string): Promise<{ jobId: string; pid: number }> {
    return this.req("/api/upgrade/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stagingId, confirm: true }),
    });
  }

  upgradeStatus(): Promise<{
    jobId?: string;
    stagingId?: string;
    phase:
      | "idle"
      | "queued"
      | "backup"
      | "extract"
      | "schema-merge"
      | "secrets"
      | "code-swap"
      | "restart"
      | "health"
      | "done"
      | "failed"
      | "rolled-back";
    percent: number;
    log: string[];
    error?: string;
    backupId?: string;
    startedAt?: string;
    endedAt?: string;
    fromVersion?: string;
    targetVersion?: string;
  }> {
    return this.req("/api/upgrade/status");
  }

  upgradeRollback(): Promise<{ jobId: string; backupId: string }> {
    return this.req("/api/upgrade/rollback", { method: "POST" });
  }

  upgradeHistory(): Promise<
    {
      jobId: string;
      stagingId: string;
      fromVersion: string;
      toVersion: string;
      startedAt: string;
      endedAt: string;
      phase: string;
      error?: string;
      backupId?: string;
    }[]
  > {
    return this.req("/api/upgrade/history");
  }

  upgradeLog(jobId: string): Promise<string> {
    return this.req(`/api/upgrade/log/${jobId}`);
  }
}

export interface DocItem {
  id: string;
  name: string;
  type: "file" | "link";
  originalName: string | null;
  mimetype: string | null;
  size: number | null;
  url: string | null;
  uploadedBy: string | null;
  createdAt: string;
}

export interface HelpRequest {
  id: string;
  ticketId: string;
  requesterName: string;
  targetName: string | null;
  targetEmail: string;
  category: string;
  question: string;
  extraNote: string | null;
  feedbackToken: string;
  status: string;
  feedback: string | null;
  feedbackBy: string | null;
  feedbackAt: string | null;
  createdAt: string;
  updatedAt: string;
  emailSent?: boolean;
  emailNote?: string;
  feedbackLink?: string;
}

export interface AuthUser {
  id: string;
  username: string;
  role: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoginResult {
  token: string;
  user: AuthUser;
  passwordMustChange?: boolean;
}

export interface OpLogEntry {
  id: string;
  session_id: string;
  user_name: string;
  category: string;
  detail: string;
  timestamp: string;
  created_at: string;
}

export interface BackupInfo {
  filename: string;
  size: number;
  createdAt: string;
}

export interface BackupSchedule {
  enabled: boolean;
  intervalHours: number;
  keepCount: number;
  lastBackupAt: string | null;
}

export interface TicketTab {
  id: string;
  ticketId: string;
  tabType: "link" | "custom";
  title: string;
  tabOrder: number;
  config: string;
  content: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export const api = new Api("");

export function setAuthToken(token: string | null) {
  if (token) {
    localStorage.setItem("combat-token", token);
  } else {
    localStorage.removeItem("combat-token");
  }
}

export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem("combat-user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user: AuthUser | null) {
  if (user) {
    localStorage.setItem("combat-user", JSON.stringify(user));
    localStorage.setItem("combat-role", user.role);
  } else {
    localStorage.removeItem("combat-user");
    localStorage.removeItem("combat-role");
  }
}
