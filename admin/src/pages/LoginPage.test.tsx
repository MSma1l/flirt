import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { App } from '../App';
import { getAccessToken, getRefreshToken } from '../auth/tokenStore';
import {
  ADMIN_ME_FIXTURE,
  STATS_FIXTURE,
  mockFetch,
  renderWithProviders,
} from '../test/harness';

const TOKENS = {
  access_token: 'acc',
  refresh_token: 'ref',
  token_type: 'bearer',
};

async function fillLogin(email: string, password: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Parolă'), password);
  await user.click(screen.getByRole('button', { name: 'Intră în panou' }));
}

describe('LoginPage', () => {
  it('autentifică un admin și intră în panou', async () => {
    mockFetch({
      'POST /admin/login': { body: TOKENS },
      'GET /admin/me': { body: ADMIN_ME_FIXTURE },
      'GET /admin/stats': { body: STATS_FIXTURE },
      'GET /admin/stats/timeseries': { body: [] },
    });

    renderWithProviders(<App />, { route: '/login' });
    await fillLogin('admin@flirt.app', 'parola-buna');

    await waitFor(() => {
      // Etichetă existentă doar pe dashboard → suntem în panou.
      expect(screen.getByText('Rapoarte în așteptare')).toBeInTheDocument();
    });
    // Access token-ul stă DOAR în memorie; refresh-ul persistă în sessionStorage.
    expect(getAccessToken()).toBe('acc');
    expect(window.localStorage.getItem('flirt_admin_refresh')).toBeNull();
    expect(getRefreshToken()).toBe('ref');
  });

  it('la 403 (cont fără rol de admin) arată un mesaj explicit, nu „eroare necunoscută"', async () => {
    mockFetch({
      'POST /admin/login': { body: TOKENS },
      'GET /admin/me': { status: 403, body: { detail: 'Admin role required' } },
    });

    renderWithProviders(<App />, { route: '/login' });
    await fillLogin('user@flirt.app', 'parola-buna');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/nu are drepturi de administrator/i);
    // Sesiunea NU rămâne deschisă pentru un cont fără rol de admin.
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it('la 401 arată „email sau parolă greșite"', async () => {
    mockFetch({
      'POST /admin/login': { status: 401, body: { detail: 'Invalid credentials' } },
    });

    renderWithProviders(<App />, { route: '/login' });
    await fillLogin('admin@flirt.app', 'parola-gresita');

    expect(await screen.findByRole('alert')).toHaveTextContent('Email sau parolă greșite.');
  });

  it('cere autentificare pentru rutele protejate', async () => {
    mockFetch({});
    renderWithProviders(<App />, { route: '/dashboard' });

    expect(await screen.findByRole('button', { name: 'Intră în panou' })).toBeInTheDocument();
  });
});
