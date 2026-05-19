import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, type AuthStatus } from '../api/client';

interface AuthContextValue {
  status: AuthStatus;
  loading: boolean;
  // Convenience: when no admin is configured anyone can act; otherwise
  // only the logged-in admin can.
  canEdit: boolean;
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const defaultStatus: AuthStatus = {
  admin_required: false,
  logged_in: false,
  username: null,
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(defaultStatus);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const s = await api.getAuthStatus();
      setStatus(s);
    } catch {
      setStatus(defaultStatus);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    await api.login(username, password);
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch { /* ignore */ }
    await refresh();
  }, [refresh]);

  const canEdit = !status.admin_required || status.logged_in;

  return (
    <AuthContext.Provider value={{ status, loading, canEdit, refresh, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
