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
import { useTheme } from '../theme/ThemeContext';

export function messageForLoginError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) {
      return 'Contul există, dar nu are drepturi de administrator. Cere-i unui admin să îți acorde rolul „admin".';
    }
    if (error.status === 401) return 'Email sau parolă greșite.';
    if (error.status === 429) {
      return 'Prea multe încercări de autentificare. Așteaptă un minut și încearcă din nou.';
    }
    if (error.status === 0) {
      return 'Serverul nu răspunde. Verifică conexiunea sau adresa API-ului.';
    }
    return error.detail;
  }
  return 'Autentificare eșuată. Încearcă din nou.';
}

export function LoginPage(): JSX.Element {
  const { status, signIn } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

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
      setError(messageForLoginError(caught));
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
        <p className="login__subtitle">Acces rezervat conturilor cu rol de administrator.</p>

        <Field label="Email" htmlFor="email">
          <TextInput
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>

        <Field label="Parolă" htmlFor="password">
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
          {busy ? 'Se autentifică…' : 'Intră în panou'}
        </Button>

        <Button variant="ghost" small onClick={toggleTheme}>
          {theme === 'dark' ? 'Temă deschisă' : 'Temă întunecată'}
        </Button>
      </form>
    </div>
  );
}
