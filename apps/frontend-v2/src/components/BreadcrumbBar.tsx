import { useMemo } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Breadcrumb } from "antd";
import { HomeOutlined } from "@ant-design/icons";

/**
 * v2.6 配置驱动面包屑。
 * 设计:
 * - 不依赖 react-router data API (createBrowserRouter / useMatches),
 *   保留对现有 <BrowserRouter> + <Routes> 的兼容。
 * - 每条 BREADCRUMBS 条目是一个 (pathname → 面包屑链) 映射;
 *   支持参数路径 (/attack/:id);label 中可读取 params。
 * - 不可点击的中间节点 label 静态写死 (与 AppLayout sidebar 一致),
 *   叶子节点根据 params 动态展示 id 简写。
 */

type Crumb = { label: string; to?: string };
type CrumbResolver = (params: Record<string, string | undefined>) => Crumb[];

interface RouteSpec {
  /** path-to-regexp 风格 (支持 :param) */
  pattern: string;
  resolve: CrumbResolver;
}

const ROOT: Crumb = { label: "首页", to: "/" };

const ROUTES: RouteSpec[] = [
  { pattern: "/", resolve: () => [{ label: "作战态势" }] },
  { pattern: "/attack", resolve: () => [{ label: "攻关管理" }, { label: "攻关作战台" }] },
  {
    pattern: "/attack/:id",
    resolve: (p) => [
      { label: "攻关管理" },
      { label: "攻关作战台", to: "/attack" },
      { label: `攻关单 ${String(p.id ?? "").slice(0, 8)}` },
    ],
  },
  { pattern: "/daily-report", resolve: () => [{ label: "攻关管理" }, { label: "攻关日报" }] },
  { pattern: "/people", resolve: () => [{ label: "人员与荣誉" }, { label: "全员名单" }] },
  { pattern: "/contributions", resolve: () => [{ label: "人员与荣誉" }, { label: "贡献录入" }] },
  { pattern: "/honor", resolve: () => [{ label: "人员与荣誉" }, { label: "荣誉殿堂" }] },
  {
    pattern: "/honor/:name",
    resolve: (p) => [
      { label: "人员与荣誉" },
      { label: "荣誉殿堂", to: "/honor" },
      { label: `${decodeURIComponent(String(p.name ?? ""))} 的荣誉` },
    ],
  },
  { pattern: "/help", resolve: () => [{ label: "求助中心" }] },
  { pattern: "/notifications", resolve: () => [{ label: "通知中心" }] },
  { pattern: "/search", resolve: () => [{ label: "工具" }, { label: "全局搜索" }] },
  { pattern: "/kg", resolve: () => [{ label: "工具" }, { label: "知识图谱" }] },
  { pattern: "/documents", resolve: () => [{ label: "工具" }, { label: "文档中心" }] },
  { pattern: "/bug-report", resolve: () => [{ label: "工具" }, { label: "问题反馈" }] },
  { pattern: "/manual", resolve: () => [{ label: "工具" }, { label: "帮助中心" }] },
  {
    pattern: "/related/:nodeType/:id",
    resolve: (p) => [
      { label: "攻关管理" },
      { label: "关联全景" },
      { label: `${p.nodeType ?? ""} ${String(p.id ?? "").slice(0, 8)}` },
    ],
  },
  { pattern: "/merge", resolve: () => [{ label: "系统管理" }, { label: "人员合并" }] },
  { pattern: "/proposals", resolve: () => [{ label: "系统管理" }, { label: "审核管理" }, { label: "关系审批" }] },
  { pattern: "/reminders", resolve: () => [{ label: "系统管理" }, { label: "审核管理" }, { label: "跟催提醒" }] },
  { pattern: "/import", resolve: () => [{ label: "系统管理" }, { label: "数据导入/导出" }] },
  { pattern: "/email", resolve: () => [{ label: "系统管理" }, { label: "邮件设置" }] },
  { pattern: "/audit", resolve: () => [{ label: "系统管理" }, { label: "审计日志" }] },
  { pattern: "/schema", resolve: () => [{ label: "系统管理" }, { label: "表结构管理" }] },
  { pattern: "/config", resolve: () => [{ label: "系统管理" }, { label: "配置中心" }] },
  { pattern: "/users", resolve: () => [{ label: "系统管理" }, { label: "用户管理" }] },
  { pattern: "/op-log", resolve: () => [{ label: "系统管理" }, { label: "操作追踪" }] },
  { pattern: "/backup", resolve: () => [{ label: "系统管理" }, { label: "备份恢复" }] },
  { pattern: "/db-migration", resolve: () => [{ label: "系统管理" }, { label: "数据库迁移" }] },
  { pattern: "/system-upgrade", resolve: () => [{ label: "系统管理" }, { label: "系统升级" }] },
];

/** 简单的 path-to-regexp 风格匹配,返回 params 或 null */
function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const pSeg = pattern.split("/").filter(Boolean);
  const aSeg = pathname.split("/").filter(Boolean);
  if (pSeg.length !== aSeg.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pSeg.length; i++) {
    if (pSeg[i].startsWith(":")) {
      params[pSeg[i].slice(1)] = aSeg[i];
    } else if (pSeg[i] !== aSeg[i]) {
      return null;
    }
  }
  return params;
}

export default function BreadcrumbBar() {
  const location = useLocation();
  const params = useParams();
  const path = location.pathname;

  const crumbs: Crumb[] = useMemo(() => {
    if (path === "/") return [];
    for (const r of ROUTES) {
      const m = matchPath(r.pattern, path);
      if (m) return r.resolve({ ...params, ...m });
    }
    return [];
  }, [path, params]);

  if (crumbs.length === 0) return null;

  const items = [ROOT, ...crumbs].map((c) => ({
    title: c.to ? (
      <Link to={c.to}>
        {c.to === "/" ? <HomeOutlined style={{ marginRight: 4 }} /> : null}
        {c.label}
      </Link>
    ) : (
      <span style={{ color: "#8c8c8c" }}>{c.label}</span>
    ),
  }));

  return <Breadcrumb data-testid="breadcrumb-bar" items={items} style={{ marginBottom: 12, fontSize: 13 }} />;
}
