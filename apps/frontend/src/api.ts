import type { GraphNode, ProgressLog, NodeSchema, FieldOp, LeaderboardEntry, PersonHonor, RelationProposal, QueryHit, QueryContext, HelperRecommendation, DashboardSummary, DailyReport, Reminder, ExpandedItem, ConflictItem, ConflictRow, ScanConflictsResult, RebuildKGResult, HermesAnswer, GraphSnapshot, AuditLogEntry, MergePreview, TransitionResult, ImportPreview, ImportRowResult, SmtpConfig, SmtpConfigMasked, EmailSendRequest, EmailSendResult, EscalationConfig, EscalationScanResult, CustomCommand, CustomCommandRunResult, PinnedUi } from "@combat/shared";

export interface RelatedResult {
  outgoing: { field: string; concept: string; node: GraphNode }[];
  incoming: { field: string; concept: string; node: GraphNode }[];
  candidates?: { proposalId: string; relationType: string; confidence: number; rationale: string; node: GraphNode }[];
  coAnchored?: { anchorKind: string; anchorKey: string; node: GraphNode }[];
  expanded?: ExpandedItem[];
  conflicts?: ConflictItem[];
}

export class Api {
  private f: typeof fetch;
  constructor(private base = "", f?: typeof fetch) {
    // Native fetch must keep its global receiver; calling a bare/instance-stored
    // reference as this.f(...) throws "Illegal invocation" in browsers.
    this.f = f ?? globalThis.fetch.bind(globalThis);
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    // §50: attach the interactive user's role so the backend can gate sensitive ops.
    const role = (typeof localStorage !== "undefined" && localStorage.getItem("combat-role")) || "normal";
    init = { ...init, headers: { ...(init.headers ?? {}), "X-Role": role } };
    const r = await this.f(`${this.base}${path}`, init);
    if (!r.ok) {
      const body = await r.json().catch(() => null);
      const detail = body?.error ?? (Array.isArray(body?.errors) ? body.errors.join("; ") : "");
      throw new Error(`HTTP ${r.status}${detail ? ` ${detail}` : ` ${r.url || path}`}`);
    }
    // Most endpoints return JSON, but some (export) return a binary/text body.
    // Read as text and try to parse JSON; fall back to raw text so a non-JSON
    // success (e.g. xlsx via runRaw) doesn't throw a parse error.
    const ct = r.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) return r.json() as Promise<T>;
    const txt = await r.text();
    try { return JSON.parse(txt) as T; } catch { return txt as unknown as T; }
  }

  listNodes(nodeType: string, filter: Record<string, string> = {}): Promise<GraphNode[]> {
    const qs = new URLSearchParams(filter).toString();
    return this.req<GraphNode[]>(`/api/nodes/${nodeType}${qs ? "?" + qs : ""}`, {});
  }
  getNode(id: string): Promise<GraphNode> {
    return this.req<GraphNode>(`/api/nodes/${id}`, {});
  }
  getSchema(nodeType: string): Promise<NodeSchema> {
    return this.req<NodeSchema>(`/api/schema/${nodeType}`, {});
  }
  listProgress(id: string): Promise<ProgressLog[]> {
    return this.req<ProgressLog[]>(`/api/nodes/${id}/progress`, {});
  }
  appendProgress(id: string, content: string, statusSnapshot: string): Promise<ProgressLog> {
    return this.req<ProgressLog>(`/api/nodes/${id}/progress`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ content, statusSnapshot, actor: "ui" }) });
  }
  createNode(nodeType: string, props: Record<string, unknown>): Promise<GraphNode> {
    return this.req<GraphNode>(`/api/nodes/${nodeType}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(props) });
  }
  updateNode(id: string, props: Record<string, unknown>): Promise<GraphNode> {
    return this.req<GraphNode>(`/api/nodes/${id}`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify(props) });
  }
  deleteNode(id: string): Promise<{ ok: boolean }> {
    return this.req<{ ok: boolean }>(`/api/nodes/${id}`, { method: "DELETE" });
  }
  patchSchema(nodeType: string, op: FieldOp): Promise<NodeSchema> {
    return this.req<NodeSchema>(`/api/schema/${nodeType}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify(op) });
  }
  getLeaderboard(period?: string): Promise<LeaderboardEntry[]> {
    const qs = period ? `?period=${encodeURIComponent(period)}` : "";
    return this.req<LeaderboardEntry[]>(`/api/honor/leaderboard${qs}`, {});
  }
  getPersonHonor(name: string): Promise<PersonHonor> {
    return this.req<PersonHonor>(`/api/honor/person/${encodeURIComponent(name)}`, {});
  }
  getRelated(nodeType: string, id: string, opts: { includeCandidates?: boolean; depth?: number } = {}): Promise<RelatedResult> {
    const p = new URLSearchParams();
    if (opts.includeCandidates) p.set("includeCandidates", "1");
    if (opts.depth && opts.depth > 1) p.set("depth", String(opts.depth));
    const qs = p.toString();
    return this.req<RelatedResult>(`/api/related/${nodeType}/${id}${qs ? "?" + qs : ""}`, {});
  }
  listProposals(status?: string): Promise<RelationProposal[]> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.req<RelationProposal[]>(`/api/proposals${qs}`, {});
  }
  scanProposals(): Promise<{ created: number }> {
    return this.req<{ created: number }>(`/api/proposals/scan`, { method: "POST" });
  }
  decideProposal(id: string, decision: string, decidedBy: string, patch?: { targetNodeId?: string }): Promise<RelationProposal> {
    return this.req<RelationProposal>(`/api/proposals/${id}/decide`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, decidedBy, patch }) });
  }
  search(q: string, type?: string): Promise<QueryHit[]> {
    const qs = new URLSearchParams({ q, ...(type ? { type } : {}) }).toString();
    return this.req<QueryHit[]>(`/api/query/search?${qs}`, {});
  }
  getContext(id: string): Promise<QueryContext> {
    return this.req<QueryContext>(`/api/query/context/${id}`, {});
  }
  recommendHelpers(id: string, limit?: number): Promise<HelperRecommendation[]> {
    const qs = limit ? `?limit=${limit}` : "";
    return this.req<HelperRecommendation[]>(`/api/recommend/helpers/${id}${qs}`, {});
  }
  getDashboard(): Promise<DashboardSummary> {
    return this.req<DashboardSummary>(`/api/dashboard`, {});
  }
  getDailyReport(date?: string): Promise<DailyReport> {
    const qs = date ? `?date=${encodeURIComponent(date)}` : "";
    return this.req<DailyReport>(`/api/daily-report${qs}`, {});
  }
  importXlsx(file: File, type?: string): Promise<{ created: number; updated: number; skipped?: number; skippedRows?: ImportRowResult[] }> {
    const fd = new FormData(); fd.append("file", file);
    const qs = type ? `?type=${encodeURIComponent(type)}` : "";
    return this.req(`/api/import${qs}`, { method: "POST", body: fd });
  }
  importPreview(file: File, type?: string): Promise<ImportPreview> {
    const fd = new FormData(); fd.append("file", file);
    const p = new URLSearchParams({ dryRun: "1" });
    if (type) p.set("type", type);
    return this.req<ImportPreview>(`/api/import?${p.toString()}`, { method: "POST", body: fd });
  }
  listReminders(status?: string): Promise<Reminder[]> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.req<Reminder[]>(`/api/reminders${qs}`, {});
  }
  scanReminders(): Promise<{ created: number }> {
    return this.req<{ created: number }>(`/api/reminders/scan`, { method: "POST" });
  }
  sendReminder(id: string, decidedBy: string): Promise<Reminder> {
    return this.req<Reminder>(`/api/reminders/${id}/send`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ decidedBy }) });
  }
  ignoreReminder(id: string, decidedBy: string): Promise<Reminder> {
    return this.req<Reminder>(`/api/reminders/${id}/ignore`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ decidedBy }) });
  }
  scanConflicts(): Promise<ScanConflictsResult> {
    return this.req<ScanConflictsResult>(`/api/conflicts/scan`, { method: "POST" });
  }
  listConflicts(): Promise<ConflictRow[]> {
    return this.req<ConflictRow[]>(`/api/conflicts`, {});
  }
  rebuildKG(): Promise<RebuildKGResult> {
    return this.req<RebuildKGResult>(`/api/kg/rebuild`, { method: "POST" });
  }
  hermesAsk(question: string): Promise<HermesAnswer> {
    return this.req<HermesAnswer>(`/api/hermes/ask`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    });
  }
  graphSnapshot(nodeType: string, id: string, depth = 1): Promise<GraphSnapshot> {
    const qs = depth > 1 ? `?depth=${depth}` : "";
    return this.req<GraphSnapshot>(`/api/graph/snapshot/${nodeType}/${id}${qs}`, {});
  }
  listAudit(filter: { action?: string; entityType?: string; entityId?: string; limit?: number } = {}): Promise<AuditLogEntry[]> {
    const p = new URLSearchParams();
    if (filter.action) p.set("action", filter.action);
    if (filter.entityType) p.set("entityType", filter.entityType);
    if (filter.entityId) p.set("entityId", filter.entityId);
    if (filter.limit) p.set("limit", String(filter.limit));
    const qs = p.toString();
    return this.req<AuditLogEntry[]>(`/api/audit${qs ? "?" + qs : ""}`, {});
  }
  mergePreview(fromId: string, toId: string): Promise<MergePreview> {
    return this.req<MergePreview>(`/api/merge/preview?fromId=${encodeURIComponent(fromId)}&toId=${encodeURIComponent(toId)}`, {});
  }
  mergePerson(fromId: string, toId: string): Promise<GraphNode> {
    return this.req<GraphNode>(`/api/merge/person`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ fromId, toId }),
    });
  }
  transition(id: string, toStatus: string, note?: string): Promise<TransitionResult> {
    return this.req<TransitionResult>(`/api/nodes/${id}/transition`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ toStatus, note }),
    });
  }
  getEmailConfig(): Promise<SmtpConfigMasked> {
    return this.req<SmtpConfigMasked>(`/api/email/config`, {});
  }
  putEmailConfig(cfg: Partial<SmtpConfig>): Promise<SmtpConfigMasked> {
    return this.req<SmtpConfigMasked>(`/api/email/config`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify(cfg),
    });
  }
  testEmail(to: string): Promise<EmailSendResult> {
    return this.req<EmailSendResult>(`/api/email/test`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ to }),
    });
  }
  sendEmail(req: EmailSendRequest): Promise<EmailSendResult> {
    return this.req<EmailSendResult>(`/api/email/send`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
  }
  getEscalationConfig(): Promise<EscalationConfig> {
    return this.req<EscalationConfig>(`/api/escalation/config`, {});
  }
  putEscalationConfig(cfg: EscalationConfig): Promise<EscalationConfig> {
    return this.req<EscalationConfig>(`/api/escalation/config`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(cfg),
    });
  }
  scanEscalation(): Promise<EscalationScanResult> {
    return this.req<EscalationScanResult>(`/api/escalation/scan`, { method: "POST" });
  }
  listCommands(): Promise<CustomCommand[]> {
    return this.req<CustomCommand[]>(`/api/commands`, {});
  }
  createCommand(cmd: { name: string; template: string; description?: string }): Promise<CustomCommand> {
    return this.req<CustomCommand>(`/api/commands`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cmd) });
  }
  deleteCommand(id: string): Promise<{ ok: boolean }> {
    return this.req<{ ok: boolean }>(`/api/commands/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
  runCommand(id: string, args: Record<string, string>): Promise<CustomCommandRunResult> {
    return this.req<CustomCommandRunResult>(`/api/commands/${encodeURIComponent(id)}/run`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ args }) });
  }
  // §57: responsibility matrix diagram
  getResponsibilityDiagram(): Promise<{ mermaid: string; nodeCount: number; edgeCount: number }> {
    return this.req(`/api/responsibility/diagram`, {});
  }
  // §57: schema wizard
  listSchemas(): Promise<NodeSchema[]> {
    return this.req<NodeSchema[]>(`/api/schema/list`, {});
  }
  suggestFields(q: string): Promise<unknown[]> {
    return this.req<unknown[]>(`/api/schema/suggest?q=${encodeURIComponent(q)}`, {});
  }
  createNodeType(data: { nodeType: string; label: string; fields: unknown[]; identityKeys?: string[] }): Promise<NodeSchema> {
    return this.req<NodeSchema>(`/api/schema/nodeType`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  }
  deleteNodeType(nodeType: string): Promise<{ ok: boolean }> {
    return this.req<{ ok: boolean }>(`/api/schema/nodeType/${encodeURIComponent(nodeType)}`, { method: "DELETE" });
  }
  // §57: UI pin/unpin
  listPinnedUi(): Promise<PinnedUi[]> {
    return this.req<PinnedUi[]>(`/api/ui-cache/pinned`, {});
  }
  pinUi(data: { label: string; question: string; intent: string; uiSpec: unknown }): Promise<PinnedUi> {
    return this.req<PinnedUi>(`/api/ui-cache/pin`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  }
  unpinUi(id: string): Promise<{ ok: boolean }> {
    return this.req<{ ok: boolean }>(`/api/ui-cache/pinned/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
  // Execute an arbitrary resolved request (from runCommand) via the same fetch pipeline.
  runRaw(request: { method: string; path: string; body?: unknown }): Promise<unknown> {
    const init: RequestInit = { method: request.method };
    if (request.body !== undefined) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(request.body);
    }
    return this.req<unknown>(request.path, init);
  }
}
export const api = new Api("");
