import type { TourProps } from "antd";

const adminSteps: TourProps["steps"] = [
  {
    title: "管理员功能引导",
    description: "作为管理员，你还可以使用以下高级功能。",
  },
  {
    title: "配置中心",
    description: "管理下拉选项（状态、优先级等）的运行时配置，无需修改代码。",
    target: () => document.querySelector('[data-menu-id="/config"]') as HTMLElement,
  },
  {
    title: "Schema 设计器",
    description: "可视化编辑表结构，添加、删除或调整字段，实时生效。",
    target: () => document.querySelector('[data-menu-id="/schema"]') as HTMLElement,
  },
  {
    title: "用户管理",
    description: "创建和管理用户账号，分配角色（管理员/Leader/普通成员）。",
    target: () => document.querySelector('[data-menu-id="/users"]') as HTMLElement,
  },
];

export default adminSteps;
