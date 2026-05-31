import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// 在 import 被测试模块前 mock 掉 api。
// 每个 test 之间 reset module + re-import,以清掉 useSettings.ts 的 module-level cache。
const listSettingsMock = vi.fn();
vi.mock("../../api.js", () => ({
  api: { listSettings: listSettingsMock },
}));

async function freshImport() {
  vi.resetModules();
  return await import("../../hooks/useSettings.js");
}

describe("useSettings", () => {
  beforeEach(() => {
    listSettingsMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("首次挂载时调用 api.listSettings 一次,后续 fresh 缓存内不再请求", async () => {
    const { useSettings } = await freshImport();
    listSettingsMock.mockResolvedValueOnce({ 状态: { values: ["待响应", "处理中"] } });

    const { result, rerender } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(listSettingsMock).toHaveBeenCalledTimes(1);
    expect(result.current.getValues("状态", [])).toEqual(["待响应", "处理中"]);

    // 第二次 rerender → 应用缓存,不发起请求
    rerender();
    expect(listSettingsMock).toHaveBeenCalledTimes(1);
  });

  it("并发多个 mount 共享 inflight Promise(dedupe)", async () => {
    const { useSettings } = await freshImport();
    let resolve!: (v: any) => void;
    listSettingsMock.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolve = res;
        })
    );

    const h1 = renderHook(() => useSettings());
    const h2 = renderHook(() => useSettings());
    const h3 = renderHook(() => useSettings());

    await act(async () => {
      resolve({ 状态: { values: ["x"] } });
    });

    await waitFor(() => {
      expect(h1.result.current.ready).toBe(true);
      expect(h2.result.current.ready).toBe(true);
      expect(h3.result.current.ready).toBe(true);
    });

    // 三个 hook 共享一次 fetch
    expect(listSettingsMock).toHaveBeenCalledTimes(1);
  });

  it("getValues:无对应配置 → 用 fallback;不传 fallback → 空数组", async () => {
    const { useSettings } = await freshImport();
    listSettingsMock.mockResolvedValueOnce({});
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.getValues("不存在", ["兜底A", "兜底B"])).toEqual(["兜底A", "兜底B"]);
    expect(result.current.getValues("不存在")).toEqual([]);
  });

  it("getOptions:返回 {value, label} 数组", async () => {
    const { useSettings } = await freshImport();
    listSettingsMock.mockResolvedValueOnce({ 等级: { values: ["核心", "关键", "普通"] } });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.ready).toBe(true));
    const opts = result.current.getOptions("等级");
    expect(opts).toEqual([
      { value: "核心", label: "核心" },
      { value: "关键", label: "关键" },
      { value: "普通", label: "普通" },
    ]);
  });

  it("refreshSettings 强制失效后再次 fetch", async () => {
    const { useSettings, refreshSettings } = await freshImport();
    listSettingsMock.mockResolvedValueOnce({ 状态: { values: ["A"] } });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(listSettingsMock).toHaveBeenCalledTimes(1);

    listSettingsMock.mockResolvedValueOnce({ 状态: { values: ["B"] } });
    await act(async () => {
      await refreshSettings();
    });
    await waitFor(() => {
      expect(result.current.getValues("状态", [])).toEqual(["B"]);
    });
    expect(listSettingsMock).toHaveBeenCalledTimes(2);
  });
});
