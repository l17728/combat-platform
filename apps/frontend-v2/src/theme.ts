import type { ThemeConfig } from 'antd';

export const themeConfig: ThemeConfig = {
  token: {
    colorPrimary: '#0050b3',
    borderRadius: 6,
    colorBgLayout: '#f5f5f5',
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif",
  },
  components: {
    Layout: {
      siderBg: '#fff',
      headerBg: '#fff',
    },
    Menu: {
      itemBorderRadius: 6,
      subMenuItemBorderRadius: 6,
    },
    Table: {
      headerBg: '#fafafa',
    },
  },
};
