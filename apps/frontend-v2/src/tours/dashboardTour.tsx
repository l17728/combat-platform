import type { TourProps } from "antd";

const dashboardSteps: TourProps["steps"] = [
  {
    title: "欢迎使用作战管理平台",
    description: "这里展示你的工作概览和待办事项。让我们快速了解一下主要功能。",
  },
  {
    title: "侧边栏导航",
    description: "通过左侧菜单访问攻关列表、人员管理、贡献录入等功能模块。点击展开可查看子菜单。",
    target: () => document.querySelector(".ant-layout-sider") as HTMLElement,
  },
  {
    title: "统计概览",
    description: "快速查看攻关单各状态的数量分布。",
    target: () => document.querySelector(".ant-statistic") as HTMLElement,
  },
  {
    title: "我的任务",
    description: "分配给你的进行中任务会显示在这里，方便快速跟进。",
    target: () => document.querySelector('[data-tour="my-tasks"]') as HTMLElement,
  },
  {
    title: "AI 助手",
    description: "点击右下角的图标，随时向 AI 提问关于攻关单、人员、贡献等问题。",
    target: () => document.querySelector(".ant-float-btn") as HTMLElement,
  },
  {
    title: "命令面板",
    description: "按 Ctrl+K 打开命令面板，快速跳转到任何页面或创建新攻关单。",
  },
];

export default dashboardSteps;
