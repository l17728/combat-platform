import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import App from "./App.js";
import { startConsoleCapture } from "./utils/console-capture.js";
import { onUnauthorized, setAuthToken, setStoredUser } from "./api.js";
import { initSentry } from "./sentry.js";
import { ThemeProvider, useThemeContext } from "./hooks/useTheme.js";
import "./markdown.css";

initSentry();

startConsoleCapture();

onUnauthorized(() => {
  setAuthToken(null);
  setStoredUser(null);
  if (window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
});

function ThemedApp() {
  const { themeConfig } = useThemeContext();
  return (
    <ConfigProvider locale={zhCN} theme={themeConfig}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ThemedApp />
    </ThemeProvider>
  </React.StrictMode>
);
