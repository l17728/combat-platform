import { useEffect, useState, useCallback } from "react";
import { message } from "antd";
import { api, type TicketTab } from "../../api.js";
import type { GraphNode, ProgressLog, HelperRecommendation, AuditLogEntry, NodeSchema } from "@combat/shared";
import type { DailyReportEntry, SupportNode, SupportTemplate, RelatedResult } from "../../api.js";
import { handleApiError } from "../../utils/handleApiError.js";

/**
 * AttackDetail 数据加载 hook:把所有 fetch / 刷新逻辑集中,
 * page 组件只接收数据 + 一个 reload 触发器。
 */
export function useAttackDetailData(id: string | undefined) {
  const [node, setNode] = useState<GraphNode | null>(null);
  const [schema, setSchema] = useState<NodeSchema | null>(null);
  const [progress, setProgress] = useState<ProgressLog[]>([]);
  const [helpers, setHelpers] = useState<HelperRecommendation[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [people, setPeople] = useState<GraphNode[]>([]);
  const [dailyReports, setDailyReports] = useState<DailyReportEntry[]>([]);
  const [supportNodes, setSupportNodes] = useState<SupportNode[]>([]);
  const [templates, setTemplates] = useState<SupportTemplate[]>([]);
  const [dynamicTabs, setDynamicTabs] = useState<TicketTab[]>([]);
  const [emailGroups, setEmailGroups] = useState<GraphNode[]>([]);

  const [initialLoading, setInitialLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [drLoading, setDrLoading] = useState(false);
  const [supportLoading, setSupportLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      const n = await api.getNode(id);
      const [p, h, a, ppl, s] = await Promise.all([
        api.listProgress(id),
        api.recommendHelpers(id, 5).catch(() => []),
        api.listAudit({ entityId: id, limit: 20 }).catch(() => []),
        api.listNodes("person").catch(() => []),
        api.getSchema("attackTicket").catch(() => null),
      ]);
      setNode(n);
      setProgress(p);
      setHelpers(h);
      setAuditLogs(a);
      setPeople(ppl);
      setSchema(s);
      setAccessDenied(false);
    } catch (e) {
      // 私密攻关单 GET 返回 403 时,显示无权访问页而非 toast 报错
      const msg = e instanceof Error ? e.message : String(e);
      if (/私密|403/.test(msg)) setAccessDenied(true);
      else message.error(msg);
    } finally {
      setInitialLoading(false);
    }
  }, [id]);

  const fetchDailyReports = useCallback(async () => {
    if (!id) return;
    setDrLoading(true);
    try {
      setDailyReports(await api.listDailyReportEntries(id));
    } catch {
      // 失败留空表;详细错误由全局日志记录
    } finally {
      setDrLoading(false);
    }
  }, [id]);

  const fetchSupportNodes = useCallback(async () => {
    if (!id) return;
    setSupportLoading(true);
    try {
      const [nodes, tmpls] = await Promise.all([api.listSupportNodes(id), api.listSupportTemplates().catch(() => [])]);
      setSupportNodes(nodes);
      setTemplates(tmpls);
    } catch (e) {
      handleApiError(e);
    } finally {
      setSupportLoading(false);
    }
  }, [id]);

  const fetchDynamicTabs = useCallback(async () => {
    if (!id) return;
    try {
      setDynamicTabs(await api.listTicketTabs(id));
    } catch {
      // 同上:留空,审计/调试看后端日志
    }
  }, [id]);

  useEffect(() => {
    fetchData();
    fetchDailyReports();
    fetchSupportNodes();
    fetchDynamicTabs();
  }, [fetchData, fetchDailyReports, fetchSupportNodes, fetchDynamicTabs]);

  useEffect(() => {
    api
      .listNodes("emailGroup")
      .then(setEmailGroups)
      .catch(() => setEmailGroups([]));
  }, []);

  // ResolverNote:暴露 setter 让 page 组件能直接编辑 dynamicTabs(新增/删除/更新),
  // 避免每次都重新拉一遍。
  return {
    node,
    schema,
    progress,
    helpers,
    auditLogs,
    people,
    dailyReports,
    supportNodes,
    templates,
    dynamicTabs,
    emailGroups,
    initialLoading,
    accessDenied,
    drLoading,
    supportLoading,
    setDynamicTabs,
    refetch: fetchData,
    refetchDailyReports: fetchDailyReports,
    refetchSupportNodes: fetchSupportNodes,
    fetchSchema: async () => {
      try {
        const s = await api.getSchema("attackTicket");
        setSchema(s);
      } catch {
        /* ignore */
      }
    },
  };
}

export type RelatedResultType = RelatedResult;
