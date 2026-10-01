/**
 * Ecranul de autentificare.
 *
 * Traduce EXACT eroarea backend-ului, ca adminul să știe ce s-a întâmplat:
 *   * 401 → credențiale greșite;
 *   * 403 → contul e valid, dar NU are rol de administrator (sau e banat);
 *   * 429 → prea multe încercări (rate limit pe `/auth/login`);
 *   * 0   → serverul nu răspunde.
 * Niciodată „eroare necunoscută".
 */
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Button, Field, TextInput } from '../components/ui';
import { useLanguage, useMessages, type Language } from '../i18n/LanguageContext';
import { coreMessages } from '../i18n/messages/core';
import { useTheme } from '../theme/ThemeContext';

/** Limba se dă explicit: funcția e apelată din afara randării (în `catch`). */
export function messageForLoginError(error: unknown, language: Language = 'ro'): string {
  const m = coreMessages[language].login;
  if (error instanceof ApiError) {
    if (error.status === 403) return m.forbidden;
    if (error.status === 401) return m.badCredentials;
    if (error.status === 429) return m.rateLimited;
    if (error.status === 0) return m.offline;
    // Textul vine de pe server — rămâne netradus.
    return error.detail;
  }
  return m.failed;
}

export function LoginPage(): JSX.Element {
  const { status, signIn } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const m = useMessages(coreMessages).login;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'authenticated') return <Navigate to="/dashboard" replace />;

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      navigate('/dashboard', { replace: true });
    } catch (caught) {
      setError(messageForLoginError(caught, language));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card login__card" onSubmit={submit}>
        <div className="login__brand">
          FLIRT <span>admin</span>
        </div>
        <p className="login__subtitle">{m.subtitle}</p>

        <Field label={m.email} htmlFor="email">
          <TextInput
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>

        <Field label={m.password} htmlFor="password">
          <TextInput
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        {error ? (
          <div className="alert" role="alert">
            {error}
          </div>
        ) : null}

        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? m.submitting : m.submit}
        </Button>

        <Button variant="ghost" small onClick={toggleTheme}>
          {theme === 'dark' ? m.themeLight : m.themeDark}
        </Button>
      </form>
    </div>
  );
}
