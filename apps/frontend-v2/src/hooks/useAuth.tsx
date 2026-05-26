import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from 'react';
import { api, setAuthToken, getStoredUser, setStoredUser, type AuthUser } from '../api.js';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  isAdmin: boolean;
  isLeader: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  login: async () => {},
  logout: () => {},
  isAdmin: false,
  isLeader: false,
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(getStoredUser());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getMe()
      .then((res) => {
        setUser(res.user);
        setStoredUser(res.user);
      })
      .catch(() => {
        setUser(null);
        setStoredUser(null);
        setAuthToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await api.login(username, password);
    setAuthToken(result.token);
    setStoredUser(result.user);
    setUser(result.user);
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    setStoredUser(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      login,
      logout,
      isAdmin: user?.role === 'admin',
      isLeader: user?.role === 'leader' || user?.role === 'admin',
    }}>
      {children}
    </AuthContext.Provider>
  );
}
