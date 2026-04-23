// HolyOS PWA — přihlašovací obrazovka.
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';

interface LocationState {
  from?: string;
}

export default function LoginPage() {
  const { status, login } = useAuth();
  const location = useLocation();
  const state = (location.state as LocationState | null) ?? null;
  const redirectTo = state?.from && state.from !== '/login' ? state.from : '/';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'authenticated') {
    return <Navigate to={redirectTo} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.status === 0
            ? 'Nelze se připojit k serveru. Zkontroluj síť.'
            : err.message
          : err instanceof Error
            ? err.message
            : 'Neznámá chyba';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <header className="login-brand">
        <div className="login-logo" aria-hidden="true">
          HOLY<span>OS</span>
        </div>
        <div className="login-subtitle">Sklad — čtečka</div>
      </header>

      <form className="login-form" onSubmit={handleSubmit} autoComplete="off">
        <label className="field">
          <span className="field-label">Uživatel</span>
          <input
            className="field-input"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            disabled={submitting}
          />
        </label>

        <label className="field">
          <span className="field-label">Heslo</span>
          <input
            className="field-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            disabled={submitting}
          />
        </label>

        {error && <div className="alert alert-error" role="alert">{error}</div>}

        <button className="btn btn-primary btn-lg" type="submit" disabled={submitting}>
          {submitting ? 'Přihlašuji…' : 'Přihlásit'}
        </button>
      </form>

      <footer className="login-footer">
        <span>HolyOS · PWA Sklad · v0.1</span>
      </footer>
    </div>
  );
}
