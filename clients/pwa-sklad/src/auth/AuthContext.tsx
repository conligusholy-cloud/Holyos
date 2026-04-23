// HolyOS PWA — auth kontext.
//
// Drží aktuálního uživatele + token, poskytuje login/logout akce a při mountu
// ověří uložený token přes /api/auth/me. 401 z apiFetch vyvolá auto-logout.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  apiFetch,
  getStoredToken,
  setStoredToken,
  setUnauthorizedHandler,
} from '../api/client';
import type { AuthUser, LoginResponse, MeResponse } from './types';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const bootstrapped = useRef(false);

  const logout = useCallback(() => {
    setStoredToken(null);
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => logout());
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    const token = getStoredToken();
    if (!token) {
      setStatus('unauthenticated');
      return;
    }

    apiFetch<MeResponse>('/api/auth/me')
      .then((data) => {
        setUser(data.user);
        setStatus('authenticated');
      })
      .catch(() => {
        setStoredToken(null);
        setStatus('unauthenticated');
      });
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const data = await apiFetch<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: { username, password },
      skipAuth: true,
    });
    setStoredToken(data.token);
    setUser(data.user);
    setStatus('authenticated');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, logout }),
    [status, user, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth musí být uvnitř <AuthProvider>');
  return ctx;
}
