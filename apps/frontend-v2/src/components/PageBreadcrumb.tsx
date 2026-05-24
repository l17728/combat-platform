import { useLocation, useNavigate, Link } from 'react-router-dom';
import { Breadcrumb } from 'antd';

const ROUTE_MAP: Record<string, { title: string; parent?: string }> = {
  '/': { title: '作战态势' },
  '/attack': { title: '攻关作战台', parent: '/attack' },
  '/daily-report': { title: '攻关日报', parent: '/attack' },
  '/people': { title: '全员名单' },
  '/contributions': { title: '贡献录入' },
  '/honor': { title: '荣誉殿堂' },
  '/merge': { title: '人员合并' },
  '/help': { title: '求助中心' },
  '/search': { title: '全局搜索' },
  '/proposals': { title: '关系审批' },
  '/reminders': { title: '跟催提醒' },
  '/import': { title: '数据导入/导出' },
  '/email': { title: '邮件设置' },
  '/audit': { title: '审计日志' },
  '/schema': { title: '表结构管理' },
  '/config': { title: '配置中心' },
};

const PARENT_MAP: Record<string, string[]> = {
  '/attack': ['攻关管理'],
  '/daily-report': ['攻关管理'],
  '/people': ['人员与荣誉'],
  '/contributions': ['人员与荣誉'],
  '/honor': ['人员与荣誉'],
  '/merge': ['人员与荣誉'],
  '/proposals': ['审核管理'],
  '/reminders': ['审核管理'],
  '/import': ['系统管理'],
  '/email': ['系统管理'],
  '/audit': ['系统管理'],
  '/schema': ['系统管理'],
  '/config': ['系统管理'],
};

export default function PageBreadcrumb() {
  const location = useLocation();
  const path = location.pathname;

  const items: { title: string; path?: string }[] = [{ title: '首页', path: '/' }];

  if (path.startsWith('/attack/') && path !== '/attack') {
    items.push({ title: '攻关管理' });
    items.push({ title: '攻关作战台', path: '/attack' });
    items.push({ title: '详情' });
    return <Breadcrumb style={{ marginBottom: 12 }} items={items} itemRender={(item) => item.path ? <Link to={item.path}>{item.title}</Link> : <span>{item.title}</span>} />;
  }

  if (path.startsWith('/honor/') && path !== '/honor') {
    items.push({ title: '人员与荣誉' });
    items.push({ title: '荣誉殿堂', path: '/honor' });
    items.push({ title: '个人荣誉' });
    return <Breadcrumb style={{ marginBottom: 12 }} items={items} itemRender={(item) => item.path ? <Link to={item.path}>{item.title}</Link> : <span>{item.title}</span>} />;
  }

  if (path.startsWith('/related/')) {
    items.push({ title: '攻关管理' });
    items.push({ title: '关联全景' });
    return <Breadcrumb style={{ marginBottom: 12 }} items={items} itemRender={(item) => item.path ? <Link to={item.path}>{item.title}</Link> : <span>{item.title}</span>} />;
  }

  const info = ROUTE_MAP[path];
  if (info) {
    const parents = PARENT_MAP[path];
    if (parents) {
      for (const p of parents) items.push({ title: p });
    }
    items.push({ title: info.title });
  }

  if (items.length <= 1) return null;

  return (
    <Breadcrumb
      style={{ marginBottom: 12 }}
      items={items}
      itemRender={(item) => item.path ? <Link to={item.path}>{item.title}</Link> : <span>{item.title}</span>}
    />
  );
}
