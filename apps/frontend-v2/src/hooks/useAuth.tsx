import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from "react";
import { api, setAuthToken, getStoredUser, setStoredUser, type AuthUser } from "../api.js";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ passwordMustChange: boolean }>;
  logout: () => void;
  isAdmin: boolean;
  isLeader: boolean;
  /** P1 强制改密:登录或 /auth/me 报告默认密未改时为 true,改密成功后清零 */
  passwordMustChange: boolean;
  clearPasswordMustChange: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  login: async () => ({ passwordMustChange: false }),
  logout: () => {},
  isAdmin: false,
  isLeader: false,
  passwordMustChange: false,
  clearPasswordMustChange: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(getStoredUser());
  const [loading, setLoading] = useState(true);
  const [passwordMustChange, setPasswordMustChange] = useState(false);

  useEffect(() => {
    api
      .getMe()
      .then((res) => {
        setUser(res.user);
        setStoredUser(res.user);
        setPasswordMustChange(!!res.passwordMustChange);
      })
      .catch(() => {
        setUser(null);
        setStoredUser(null);
        setAuthToken(null);
        setPasswordMustChange(false);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await api.login(username, password);
    setAuthToken(result.token);
    setStoredUser(result.user);
    setUser(result.user);
    setPasswordMustChange(!!result.passwordMustChange);
    return { passwordMustChange: !!result.passwordMustChange };
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    setStoredUser(null);
    setUser(null);
    setPasswordMustChange(false);
  }, []);

  const clearPasswordMustChange = useCallback(() => setPasswordMustChange(false), []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        isAdmin: user?.role === "admin",
        isLeader: user?.role === "leader" || user?.role === "admin",
        passwordMustChange,
        clearPasswordMustChange,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
