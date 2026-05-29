import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { themeConfig } from './theme.js';
import App from './App.js';
import { startConsoleCapture } from './utils/console-capture.js';
import './markdown.css';

// Install console capture at boot so 问题反馈 can attach recent console logs.
startConsoleCapture();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={themeConfig}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>,
);
