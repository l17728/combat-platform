import { useState, useCallback, useEffect, createContext, useContext, type ReactNode } from "react";
import type { ThemeConfig } from "antd";
import { type ThemeMode, getThemeConfig } from "../theme.js";

const STORAGE_KEY = "combat-theme";

export function loadThemeMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {}
  return "light";
}

interface ThemeContextValue {
  mode: ThemeMode;
  isDark: boolean;
  toggleMode: () => void;
  themeConfig: ThemeConfig;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: "light",
  isDark: false,
  toggleMode: () => {},
  themeConfig: getThemeConfig("light"),
});

export function useThemeContext() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(loadThemeMode);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", mode);
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  const toggleMode = useCallback(() => {
    setMode((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const isDark = mode === "dark";
  const themeConfig = getThemeConfig(mode);

  return <ThemeContext.Provider value={{ mode, isDark, toggleMode, themeConfig }}>{children}</ThemeContext.Provider>;
}
