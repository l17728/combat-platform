import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StatusTag from "../../components/StatusTag.js";
import { STATUS_COLOR, LEVEL_COLOR, CONTRIBUTION_COLOR } from "../../constants.js";

describe("<StatusTag>", () => {
  it("默认 type=status:渲染文字 + 走 STATUS_COLOR 映射", () => {
    const { container } = render(<StatusTag status="处理中" />);
    expect(screen.getByText("处理中")).toBeInTheDocument();
    const tag = container.querySelector(".ant-tag");
    expect(tag?.className).toMatch(new RegExp(`ant-tag-${STATUS_COLOR["处理中"]}`));
  });

  it("type=level → LEVEL_COLOR 映射", () => {
    const { container } = render(<StatusTag status="高" type="level" />);
    expect(screen.getByText("高")).toBeInTheDocument();
    const tag = container.querySelector(".ant-tag");
    expect(tag?.className).toMatch(new RegExp(`ant-tag-${LEVEL_COLOR["高"]}`));
  });

  it("type=contribution → CONTRIBUTION_COLOR 映射", () => {
    const { container } = render(<StatusTag status="核心" type="contribution" />);
    expect(screen.getByText("核心")).toBeInTheDocument();
    const tag = container.querySelector(".ant-tag");
    expect(tag?.className).toMatch(new RegExp(`ant-tag-${CONTRIBUTION_COLOR["核心"]}`));
  });

  it("未知 status → 退到 default 色", () => {
    const { container } = render(<StatusTag status="完全不存在的状态" />);
    const tag = container.querySelector(".ant-tag");
    // Ant Design 5 中 default 色不会拼 ant-tag-{color} class,但 tag 元素仍渲染
    expect(tag).toBeTruthy();
    expect(screen.getByText("完全不存在的状态")).toBeInTheDocument();
  });

  it("status=已解决 包含状态图标", () => {
    const { container } = render(<StatusTag status="已解决" />);
    // CheckCircleOutlined 渲染为 .anticon-check-circle
    expect(container.querySelector(".anticon-check-circle")).toBeTruthy();
  });

  it("level 类型不渲染状态图标(避免误用)", () => {
    const { container } = render(<StatusTag status="待响应" type="level" />);
    expect(container.querySelector(".anticon-clock-circle")).toBeFalsy();
  });
});
