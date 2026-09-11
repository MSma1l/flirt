/**
 * POARTA: ce vede utilizatorul imediat după autentificare.
 *
 * Ăsta e testul care apără chiar defectul din producție — cont creat prin
 * Telegram, profil necompletat, aplicația arăta feed-ul gol în loc de un ecran
 * de înregistrare.
 */
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/api/client';
import { useAuthStore } from '@/auth/authStore';
import { AppRoutes } from '@/routes';

import { httpError, renderRouted } from './testUtils';

// Feed-ul e reutilizat din aplicația Expo și ar porni cereri reale.
vi.mock('@mobile/features/feed/feedApi', () => ({
  fetchFeed: vi.fn(async () => []),
  swipe: vi.fn(),
  undoSwipe: vi.fn(),
}));

function mockMe(profileCompleted: boolean) {
  return vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/auth/me') {
      return { data: { id: 'u1', email: 'a@b.c', profile_completed: profileCompleted } } as never;
    }
    throw httpError(404);
  });
}

beforeEach(() => {
  useAuthStore.setState({ status: 'idle', user: null, error: null, optimisticName: null });
});

describe('poarta profile_completed', () => {
  it('profil NECOMPLETAT → ecranul de înregistrare, nu feed-ul', async () => {
    mockMe(false);

    renderRouted(<AppRoutes />);

    expect(await screen.findByTestId('welcome-cta')).toBeInTheDocument();
    // Nicio urmă de aplicație normală cât timp profilul nu e gata.
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('profil COMPLETAT → aplicația normală, cu bara de taburi', async () => {
    mockMe(true);

    renderRouted(<AppRoutes />);

    expect(await screen.findByRole('navigation')).toBeInTheDocument();
    expect(screen.queryByTestId('welcome-cta')).not.toBeInTheDocument();
  });

  it('refolosește răspunsul pe care autentificarea tocmai l-a primit', async () => {
    // `authStore.user` vine dintr-un `/auth/me` făcut cu o clipă înainte, în
    // `signIn()`. A-l cere din nou la pornire ar fi aceeași cerere de două ori.
    const get = mockMe(false);
    useAuthStore.setState({
      status: 'authenticated',
      user: { id: 'u1', email: 'a@b.c', profile_completed: true },
      error: null,
      optimisticName: null,
    });

    renderRouted(<AppRoutes />);

    expect(await screen.findByRole('navigation')).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it('cu /auth/me picat arată o eroare cu reîncercare, nu un ecran gol', async () => {
    const get = vi.spyOn(api, 'get').mockRejectedValue(httpError(500));

    renderRouted(<AppRoutes />);

    expect(await screen.findByTestId('gate-retry')).toBeInTheDocument();
    expect(screen.queryByTestId('welcome-cta')).not.toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalled());
  });

  it('o rută necunoscută duce la înregistrare cât timp profilul nu e gata', async () => {
    mockMe(false);

    renderRouted(<AppRoutes />, ['/feed']);

    expect(await screen.findByTestId('welcome-cta')).toBeInTheDocument();
  });
});
