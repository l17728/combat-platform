import type {
  GraphNode,
  ProgressLog,
  NodeSchema,
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
} from '@combat/shared';

export interface RelatedResult {
  outgoing: { field: string; concept: string; node: GraphNode }[];
  incoming: { field: string; concept: string; node: GraphNode }[];
}

export class Api {
  private f: typeof fetch;
  constructor(private base = '', f?: typeof fetch) {
    this.f = f ?? globalThis.fetch.bind(globalThis);
    if (!this.base) {
      this.base = (typeof window !== 'undefined' && (window as any).__COMBAT_API__) || '';
    }
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const role =
      (typeof localStorage !== 'undefined' && localStorage.getItem('combat-role')) || 'normal';
    init = { ...init, headers: { ...(init.headers ?? {}), 'X-Role': role } };
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

  getRelated(nodeType: string, id: string): Promise<RelatedResult> {
    return this.req<RelatedResult>(`/api/related/${nodeType}/${id}`);
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

export const api = new Api('');
