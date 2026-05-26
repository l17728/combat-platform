import type {
  GraphNode,
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
} from '@combat/shared';

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
  status: '草稿' | '已发布';
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
  status: '待审批' | '已通过' | '已拒绝';
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
  status: '待发送' | '已发送' | '已忽略';
  decidedBy?: string;
  decidedAt?: string;
  createdAt: string;
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

export class Api {
  private f: typeof fetch;
  constructor(private base = '', f?: typeof fetch) {
    this.f = f ?? globalThis.fetch.bind(globalThis);
    if (!this.base) {
      this.base = '';
    }
  }

  private getToken(): string | null {
    try { return localStorage.getItem('combat-token'); } catch { return null; }
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string> ?? {}) };
    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const role = (typeof localStorage !== 'undefined' && localStorage.getItem('combat-role')) || 'normal';
    headers['X-Role'] = role;
    init = { ...init, headers };
    const r = await this.f(`${this.base}${path}`, init);
    if (!r.ok) {
      const body = await r.json().catch(() => null);
      const detail = body?.error ?? (Array.isArray(body?.errors) ? body.errors.join('; ') : '');
      throw new Error(`HTTP ${r.status}${detail ? ` ${detail}` : ` ${r.url || path}`}`);
    }
    const ct = r.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) return r.json() as Promise<T>;
    const txt = await r.text();
    try {
      return JSON.parse(txt) as T;
    } catch {
      return txt as unknown as T;
    }
  }

  listNodes(nodeType: string, filter: Record<string, string> = {}): Promise<GraphNode[]> {
    const qs = new URLSearchParams(filter).toString();
    return this.req<GraphNode[]>(`/api/nodes/${nodeType}${qs ? '?' + qs : ''}`);
  }

  getNode(id: string): Promise<GraphNode> {
    return this.req<GraphNode>(`/api/nodes/${id}`);
  }

  getSchema(nodeType: string): Promise<NodeSchema> {
    return this.req<NodeSchema>(`/api/schema/${nodeType}`);
  }

  createNode(nodeType: string, props: Record<string, unknown>): Promise<GraphNode> {
    return this.req<GraphNode>(`/api/nodes/${nodeType}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(props),
    });
  }

  updateNode(id: string, props: Record<string, unknown>): Promise<GraphNode> {
    return this.req<GraphNode>(`/api/nodes/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(props),
    });
  }

  deleteNode(id: string): Promise<{ ok: boolean }> {
    return this.req<{ ok: boolean }>(`/api/nodes/${id}`, { method: 'DELETE' });
  }

  listProgress(id: string): Promise<ProgressLog[]> {
    return this.req<ProgressLog[]>(`/api/nodes/${id}/progress`);
  }

  appendProgress(id: string, content: string, statusSnapshot: string): Promise<ProgressLog> {
    return this.req<ProgressLog>(`/api/nodes/${id}/progress`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content, statusSnapshot, actor: 'ui' }),
    });
  }

  transition(id: string, toStatus: string, note?: string): Promise<TransitionResult> {
    return this.req<TransitionResult>(`/api/nodes/${id}/transition`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toStatus, note }),
    });
  }

  recommendHelpers(id: string, limit?: number): Promise<HelperRecommendation[]> {
    const qs = limit ? `?limit=${limit}` : '';
    return this.req<HelperRecommendation[]>(`/api/recommend/helpers/${id}${qs}`);
  }

  getDashboard(): Promise<DashboardSummary> {
    return this.req<DashboardSummary>('/api/dashboard');
  }

  getLeaderboard(period?: string): Promise<LeaderboardEntry[]> {
    const qs = period ? `?period=${encodeURIComponent(period)}` : '';
    return this.req<LeaderboardEntry[]>(`/api/honor/leaderboard${qs}`);
  }

  getPersonHonor(name: string): Promise<PersonHonor> {
    return this.req<PersonHonor>(`/api/honor/person/${encodeURIComponent(name)}`);
  }

  listAudit(filter: {
    action?: string;
    entityType?: string;
    entityId?: string;
    limit?: number;
  } = {}): Promise<AuditLogEntry[]> {
    const p = new URLSearchParams();
    if (filter.action) p.set('action', filter.action);
    if (filter.entityType) p.set('entityType', filter.entityType);
    if (filter.entityId) p.set('entityId', filter.entityId);
    if (filter.limit) p.set('limit', String(filter.limit));
    const qs = p.toString();
    return this.req<AuditLogEntry[]>(`/api/audit${qs ? '?' + qs : ''}`);
  }

  mergePreview(fromId: string, toId: string): Promise<MergePreview> {
    return this.req<MergePreview>(
      `/api/merge/preview?fromId=${encodeURIComponent(fromId)}&toId=${encodeURIComponent(toId)}`,
    );
  }

  mergePerson(fromId: string, toId: string): Promise<GraphNode> {
    return this.req<GraphNode>('/api/merge/person', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromId, toId }),
    });
  }

  importXlsx(
    file: File,
    type?: string,
  ): Promise<{ created: number; updated: number; skipped?: number }> {
    const fd = new FormData();
    fd.append('file', file);
    const qs = type ? `?type=${encodeURIComponent(type)}` : '';
    return this.req(`/api/import${qs}`, { method: 'POST', body: fd });
  }

  importPreview(file: File, type?: string): Promise<ImportPreview> {
    const fd = new FormData();
    fd.append('file', file);
    const p = new URLSearchParams({ dryRun: '1' });
    if (type) p.set('type', type);
    return this.req<ImportPreview>(`/api/import?${p.toString()}`, { method: 'POST', body: fd });
  }

  exportNodes(nodeType: string): Promise<Blob> {
    return this.f(`${this.base}/api/export/${nodeType}`).then((r) => r.blob());
  }

  getEmailConfig(): Promise<SmtpConfigMasked> {
    return this.req<SmtpConfigMasked>('/api/email/config');
  }

  putEmailConfig(cfg: Partial<SmtpConfig>): Promise<SmtpConfigMasked> {
    return this.req<SmtpConfigMasked>('/api/email/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cfg),
    });
  }

  testEmail(to: string): Promise<EmailSendResult> {
    return this.req<EmailSendResult>('/api/email/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to }),
    });
  }

  sendEmail(req: EmailSendRequest): Promise<EmailSendResult> {
    return this.req<EmailSendResult>('/api/email/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
  }

  patchSchema(nodeType: string, op: FieldOp): Promise<NodeSchema> {
    return this.req<NodeSchema>(`/api/schema/${nodeType}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
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
    return this.req<HelpRequest>('/api/help-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  listHelpRequests(params?: { ticketId?: string; status?: string }): Promise<HelpRequest[]> {
    const p = new URLSearchParams();
    if (params?.ticketId) p.set('ticketId', params.ticketId);
    if (params?.status) p.set('status', params.status);
    const qs = p.toString();
    return this.req<HelpRequest[]>(`/api/help-requests${qs ? '?' + qs : ''}`);
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
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ feedback, name }),
    });
  }

  getRelated(nodeType: string, id: string, opts?: { includeCandidates?: boolean; depth?: number }): Promise<RelatedResult> {
    const p = new URLSearchParams();
    if (opts?.includeCandidates) p.set('includeCandidates', '1');
    if (opts?.depth) p.set('depth', String(opts.depth));
    const qs = p.toString();
    return this.req<RelatedResult>(`/api/related/${nodeType}/${id}${qs ? '?' + qs : ''}`);
  }

  getDailyReport(date: string): Promise<DailyReport> {
    return this.req<DailyReport>(`/api/daily-report?date=${encodeURIComponent(date)}`);
  }

  publishDailyReport(date: string): Promise<{ date: string; ticketsTouched: number; published: number }> {
    return this.req('/api/daily-report/publish?date=' + encodeURIComponent(date), { method: 'POST' });
  }

  listDailyReportEntries(ticketId: string): Promise<DailyReportEntry[]> {
    return this.req<DailyReportEntry[]>(`/api/nodes/${ticketId}/daily-reports`);
  }

  createDailyReportEntry(ticketId: string, data: { type: string; currentProgress: string; nextSteps?: string }): Promise<DailyReportEntry> {
    return this.req<DailyReportEntry>(`/api/nodes/${ticketId}/daily-reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  publishDailyReportEntry(ticketId: string, entryId: string): Promise<DailyReportEntry> {
    return this.req<DailyReportEntry>(`/api/nodes/${ticketId}/daily-reports/${entryId}/publish`, { method: 'POST' });
  }

  deleteDailyReportEntry(ticketId: string, entryId: string): Promise<void> {
    return this.req(`/api/nodes/${ticketId}/daily-reports/${entryId}`, { method: 'DELETE' });
  }

  listSupportNodes(ticketId: string): Promise<SupportNode[]> {
    return this.req<SupportNode[]>(`/api/support-nodes/${ticketId}`);
  }

  createSupportNode(ticketId: string, data: Partial<SupportNode>): Promise<SupportNode> {
    return this.req<SupportNode>(`/api/support-nodes/${ticketId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  updateSupportNode(nodeId: string, data: Partial<SupportNode>): Promise<SupportNode> {
    return this.req<SupportNode>(`/api/support-nodes/node/${nodeId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  deleteSupportNode(nodeId: string): Promise<{ deleted: number }> {
    return this.req(`/api/support-nodes/node/${nodeId}`, { method: 'DELETE' });
  }

  listSupportTemplates(): Promise<SupportTemplate[]> {
    return this.req<SupportTemplate[]>('/api/support-templates');
  }

  applySupportTemplate(templateId: string, ticketId: string): Promise<{ applied: number; nodes: SupportNode[] }> {
    return this.req(`/api/support-templates/${templateId}/apply/${ticketId}`, { method: 'POST' });
  }

  listSchemas(): Promise<NodeSchema[]> {
    return this.req<NodeSchema[]>('/api/schema/list');
  }

  createSchema(data: { nodeType: string; label: string; fields: FieldSchema[]; identityKeys?: string[] }): Promise<NodeSchema> {
    return this.req<NodeSchema>('/api/schema/nodeType', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  deleteSchema(nodeType: string): Promise<{ ok: boolean }> {
    return this.req(`/api/schema/nodeType/${nodeType}`, { method: 'DELETE' });
  }

  suggestSchema(q: string): Promise<SchemaSuggestion[]> {
    return this.req<SchemaSuggestion[]>(`/api/schema/suggest?q=${encodeURIComponent(q)}`);
  }

  getTeamLeaderboard(period?: string): Promise<TeamLeaderboardEntry[]> {
    const qs = period ? `?period=${encodeURIComponent(period)}&groupBy=team` : '?groupBy=team';
    return this.req<TeamLeaderboardEntry[]>(`/api/honor/leaderboard${qs}`);
  }

  searchNodes(q: string, type?: string, limit?: number): Promise<{ id: string; nodeType: string; summary: string; score: number }[]> {
    const p = new URLSearchParams({ q });
    if (type) p.set('type', type);
    if (limit) p.set('limit', String(limit));
    return this.req(`/api/query/search?${p.toString()}`);
  }

  hermesAsk(question: string): Promise<{ question: string; intent: string; answer: string; citations: { nodeId: string; nodeType: string; summary: string; link: string }[]; uiSpec?: any }> {
    return this.req('/api/hermes/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question }),
    });
  }

  listSettings(): Promise<Record<string, { values: string[]; label?: string }>> {
    return this.req('/api/settings');
  }

  getSetting(key: string): Promise<{ values: string[]; label?: string }> {
    return this.req(`/api/settings/${encodeURIComponent(key)}`);
  }

  resolveSetting(key: string, scope?: string): Promise<{ values: string[]; label?: string }> {
    const p = scope ? `?scope=${encodeURIComponent(scope)}` : '';
    return this.req(`/api/settings/${encodeURIComponent(key)}/resolve${p}`);
  }

  setSetting(key: string, values: string[], label?: string): Promise<{ key: string; values: string[]; label?: string }> {
    return this.req(`/api/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ values, label }),
    });
  }

  deleteSetting(key: string): Promise<{ deleted: string }> {
    return this.req(`/api/settings/${encodeURIComponent(key)}`, { method: 'DELETE' });
  }

  scanProposals(): Promise<{ created: number }> {
    return this.req('/api/proposals/scan', { method: 'POST' });
  }

  listProposals(status?: string): Promise<RelationProposal[]> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.req<RelationProposal[]>(`/api/proposals${qs}`);
  }

  decideProposal(id: string, decision: string, decidedBy: string, patch?: { targetNodeId: string }): Promise<RelationProposal> {
    return this.req<RelationProposal>(`/api/proposals/${id}/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision, decidedBy, patch }),
    });
  }

  scanReminders(): Promise<{ created: number }> {
    return this.req('/api/reminders/scan', { method: 'POST' });
  }

  listReminders(status?: string): Promise<Reminder[]> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.req<Reminder[]>(`/api/reminders${qs}`);
  }

  sendReminder(id: string, decidedBy: string): Promise<Reminder> {
    return this.req<Reminder>(`/api/reminders/${id}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decidedBy }),
    });
  }

  ignoreReminder(id: string, decidedBy: string): Promise<Reminder> {
    return this.req<Reminder>(`/api/reminders/${id}/ignore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decidedBy }),
    });
  }

  getContext(id: string): Promise<QueryContext> {
    return this.req<QueryContext>(`/api/query/context/${id}`);
  }

  createBugReport(data: {
    title: string; description?: string; severity?: string;
    pageUrl?: string; reporter?: string; screenshot?: string; consoleLogs?: string; userAgent?: string;
  }): Promise<any> {
    return this.req('/api/bug-reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  listBugReports(status?: string): Promise<any[]> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.req(`/api/bug-reports${qs}`);
  }

  getBugReport(id: string): Promise<any> {
    return this.req(`/api/bug-reports/${id}`);
  }

  updateBugReport(id: string, data: { status?: string; resolution?: string; resolvedBy?: string }): Promise<any> {
    return this.req(`/api/bug-reports/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  deleteBugReport(id: string): Promise<{ deleted: string }> {
    return this.req(`/api/bug-reports/${id}`, { method: 'DELETE' });
  }

  login(username: string, password: string): Promise<LoginResult> {
    return this.req('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  }

  register(username: string, password: string, displayName?: string, role?: string): Promise<LoginResult> {
    return this.req('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, displayName, role }),
    });
  }

  getMe(): Promise<{ user: AuthUser }> {
    return this.req('/api/auth/me');
  }

  changePassword(oldPassword: string, newPassword: string): Promise<{ ok: boolean }> {
    return this.req('/api/auth/change-password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword, newPassword }),
    });
  }

  listUsers(): Promise<AuthUser[]> {
    return this.req('/api/users');
  }

  createUser(data: { username: string; password: string; displayName?: string; role?: string }): Promise<AuthUser> {
    return this.req('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  updateUser(id: string, data: { role?: string; displayName?: string; password?: string }): Promise<AuthUser> {
    return this.req(`/api/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  deleteUser(id: string): Promise<{ ok: boolean }> {
    return this.req(`/api/users/${id}`, { method: 'DELETE' });
  }
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
}

export const api = new Api('');

export function setAuthToken(token: string | null) {
  if (token) {
    localStorage.setItem('combat-token', token);
  } else {
    localStorage.removeItem('combat-token');
  }
}

export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem('combat-user');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function setStoredUser(user: AuthUser | null) {
  if (user) {
    localStorage.setItem('combat-user', JSON.stringify(user));
    localStorage.setItem('combat-role', user.role);
  } else {
    localStorage.removeItem('combat-user');
    localStorage.removeItem('combat-role');
  }
}
