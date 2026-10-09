import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, APIError } from './api';

const AuthContext = createContext<{
  checking: boolean;
  authenticated: boolean;
  error: string;
  login: (key: string) => Promise<void>;
  logout: () => Promise<void>;
} | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const expired = () => {
      setAuthenticated(false);
      setError('');
      void client.cancelQueries();
      client.clear();
    };

    window.addEventListener('session-expired', expired);
    void api('auth/session', { signal: controller.signal })
      .then(() => {
        if (!controller.signal.aborted) setAuthenticated(true);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted && !(e instanceof APIError && e.status === 401))
          setError('Dashboard is unreachable. Check the connection and try again.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });

    return () => {
      controller.abort();
      window.removeEventListener('session-expired', expired);
    };
  }, [client]);

  const login = async (key: string) => {
    await api('auth/login', { method: 'POST', body: JSON.stringify({ key }) });
    setError('');
    setAuthenticated(true);
  };

  const logout = async () => {
    try {
      await api('auth/logout', { method: 'POST' });
      setAuthenticated(false);
      setError('');
      await client.cancelQueries();
      client.clear();
    } catch {
      setError('Could not sign out. Please try again.');
    }
  };

  return (
    <AuthContext.Provider value={{ checking, authenticated, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);

  if (!value) throw new Error('AuthProvider is required');

  return value;
}
