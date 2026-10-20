import type { TourProps } from "antd";

const attackListSteps: TourProps["steps"] = [
  {
    title: "攻关列表",
    description: "这里是所有攻关单的集中管理页面，支持筛选、搜索、批量操作。",
  },
  {
    title: "筛选与搜索",
    description: "通过顶部的筛选栏按状态、优先级等条件快速定位攻关单。",
    target: () => document.querySelector('[data-tour="filters"]') as HTMLElement,
  },
  {
    title: "新建攻关单",
    description: "点击「新建」按钮创建新的攻关单，填写标题和相关信息。",
    target: () => document.querySelector('[data-tour="create-btn"]') as HTMLElement,
  },
  {
    title: "导出数据",
    description: "支持将攻关单列表导出为 Excel 文件，方便离线查看和汇报。",
    target: () => document.querySelector('[data-tour="export-btn"]') as HTMLElement,
  },
];

export default attackListSteps;
