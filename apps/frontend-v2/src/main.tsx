import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { themeConfig } from "./theme.js";
import App from "./App.js";
import { startConsoleCapture } from "./utils/console-capture.js";
import { onUnauthorized, setAuthToken, setStoredUser } from "./api.js";
import { initSentry } from "./sentry.js";
import "./markdown.css";

initSentry();

// Install console capture at boot so 问题反馈 can attach recent console logs.
startConsoleCapture();

// 全局 401 处理:任何 api.* 调用返回 401 → 清 token + 跳登录。
// AuthProvider 启动 /auth/me 探活的 401 已在 api.req 内排除,不会触发这里。
// 避免在登录页本身重复跳转。
onUnauthorized(() => {
  setAuthToken(null);
  setStoredUser(null);
  if (window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={themeConfig}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>
);
