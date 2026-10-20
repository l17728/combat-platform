import type { ThemeConfig } from "antd";
import theme from "antd/es/theme";

const commonToken = {
  borderRadius: 6,
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif",
};

export type ThemeMode = "light" | "dark";

export const lightTheme: ThemeConfig = {
  token: {
    ...commonToken,
    colorPrimary: "#0050b3",
    colorBgLayout: "#f5f5f5",
  },
  components: {
    Layout: { siderBg: "#fff", headerBg: "#fff" },
    Menu: { itemBorderRadius: 6, subMenuItemBorderRadius: 6 },
    Table: { headerBg: "#fafafa" },
  },
};

export const darkTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    ...commonToken,
    colorPrimary: "#177ddc",
  },
  components: {
    Layout: { siderBg: "#141414", headerBg: "#141414" },
    Menu: { itemBorderRadius: 6, subMenuItemBorderRadius: 6 },
    Table: { headerBg: "#1d1d1d" },
  },
};

export function getThemeConfig(mode: ThemeMode): ThemeConfig {
  return mode === "dark" ? darkTheme : lightTheme;
}
