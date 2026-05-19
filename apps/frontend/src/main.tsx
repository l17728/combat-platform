import React from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd";
import App from "./App.js";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider autoInsertSpaceInButton={false}>
      <App />
    </ConfigProvider>
  </React.StrictMode>
);
