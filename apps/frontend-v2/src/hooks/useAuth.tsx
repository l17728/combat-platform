import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from "react";
import { api, setAuthToken, getStoredUser, setStoredUser, type AuthUser } from "../api.js";

const ACTIVE_TENANT_KEY = "activeTenant";

interface ActiveTenant {
  tenantId: string | null;
  tenantName: string;
}

function getStoredTenant(): ActiveTenant {
  try {
    const raw = localStorage.getItem(ACTIVE_TENANT_KEY);
    return raw ? JSON.parse(raw) : { tenantId: null, tenantName: "全局视图" };
  } catch {
    return { tenantId: null, tenantName: "全局视图" };
  }
}

function setStoredTenant(t: ActiveTenant | null) {
  if (t) {
    localStorage.setItem(ACTIVE_TENANT_KEY, JSON.stringify(t));
  } else {
    localStorage.removeItem(ACTIVE_TENANT_KEY);
  }
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ passwordMustChange: boolean }>;
  logout: () => void;
  isAdmin: boolean;
  isLeader: boolean;
  isSuperAdmin: boolean;
  isGuest: boolean;
  passwordMustChange: boolean;
  clearPasswordMustChange: () => void;
  activeTenantId: string | null;
  activeTenantName: string;
  switchTenant: (tenantId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  login: async () => ({ passwordMustChange: false }),
  logout: () => {},
  isAdmin: false,
  isLeader: false,
  isSuperAdmin: false,
  isGuest: false,
  passwordMustChange: false,
  clearPasswordMustChange: () => {},
  activeTenantId: null,
  activeTenantName: "全局视图",
  switchTenant: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(getStoredUser());
  const [loading, setLoading] = useState(true);
  const [passwordMustChange, setPasswordMustChange] = useState(false);
  const [activeTenant, setActiveTenant] = useState<ActiveTenant>(getStoredTenant);

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
    if (result.user.role === "superadmin") {
      setActiveTenant({ tenantId: null, tenantName: "全局视图" });
      setStoredTenant({ tenantId: null, tenantName: "全局视图" });
    }
    return { passwordMustChange: !!result.passwordMustChange };
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    setStoredUser(null);
    setUser(null);
    setPasswordMustChange(false);
    setActiveTenant({ tenantId: null, tenantName: "全局视图" });
    setStoredTenant(null);
  }, []);

  const clearPasswordMustChange = useCallback(() => setPasswordMustChange(false), []);

  const switchTenant = useCallback(
    async (tenantId: string) => {
      const result = await api.switchTenant(tenantId);
      setAuthToken(result.token);
      const newTenant: ActiveTenant = {
        tenantId: result.tenantId ?? null,
        tenantName: result.tenantName,
      };
      setActiveTenant(newTenant);
      setStoredTenant(newTenant);
      if (user) {
        const updatedUser = { ...user, tenantId: result.tenantId ?? undefined };
        setStoredUser(updatedUser);
        setUser(updatedUser);
      }
    },
    [user]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        isAdmin: user?.role === "admin" || user?.role === "superadmin",
        isLeader: user?.role === "leader" || user?.role === "admin" || user?.role === "superadmin",
        isSuperAdmin: user?.role === "superadmin",
        isGuest: user?.username?.startsWith("guest_") ?? false,
        passwordMustChange,
        clearPasswordMustChange,
        activeTenantId: activeTenant.tenantId,
        activeTenantName: activeTenant.tenantName,
        switchTenant,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
