/**
 * RUTA `/verificare`, exact așa cum o atinge un utilizator: prin `AppRoutes`.
 *
 * Ăsta e testul care apără decizia proprietarului. Pe serverul real, providerul
 * de comparare facială era `stub` — întorcea „verificat" pentru oricine — deci
 * insigna de încredere se câștiga apăsând un buton. Cât timp funcția nu e reală,
 * ea nu are voie să apară NICĂIERI: nici ca buton, nici ca rută accesibilă
 * dintr-un link vechi. Și, mai ales, nu are voie să plece nicio cerere de
 * verificare.
 *
 * Testăm prin `AppRoutes`, nu doar componenta, fiindcă jumătate din cerință e
 * chiar legătura din `routes.tsx`: ruta rămâne înregistrată, dar duce la un
 * mesaj, nu la flux.
 */
import { screen, waitFor } from '@testing-library/react';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/api/client';
import { useAuthStore } from '@/auth/authStore';
import { CAPABILITIES_PATH } from '@/features/capabilities';
import { AppRoutes } from '@/routes';
import { renderWithProviders } from '@/test/harness';

import { VERIFICATION_PATH } from '../verificationRoutes';

// Feed-ul e reutilizat din aplicația Expo; nu e randat aici, dar nu vrem nici
// măcar riscul unei cereri reale dacă o rută se schimbă sub noi.
vi.mock('@mobile/features/feed/feedApi', () => ({
  fetchFeed: vi.fn(async () => []),
  swipe: vi.fn(),
  undoSwipe: vi.fn(),
}));

const CONFIG = { headers: {} } as InternalAxiosRequestConfig;

function notFound(): AxiosError {
  return new AxiosError('eroare', 'ERR_BAD_REQUEST', CONFIG, null, {
    data: {},
    status: 404,
    statusText: '',
    headers: {},
    config: CONFIG,
  });
}

/** Profilul brut (snake_case) al unui cont cu poze, încă neverificat. */
const PROFILE_RESPONSE = {
  name: 'Ana',
  birth_date: '1996-05-04',
  age: 29,
  gender: 'female',
  height_cm: 170,
  city: 'Chisinau',
  languages: ['ro'],
  dating_statuses: ['serious'],
  interests: ['music'],
  photos: ['https://cdn.example/1.jpg'],
  completed: true,
  verified: false,
};

/**
 * Serverul, cu o singură variabilă: ce spune despre verificare.
 * `null` = ruta de capabilități nu răspunde deloc.
 */
function mockServer(faceVerification: boolean | null) {
  return vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/auth/me') {
      return { data: { id: 'u1', email: 'a@b.c', profile_completed: true } } as never;
    }
    if (url === CAPABILITIES_PATH) {
      if (faceVerification === null) throw notFound();
      return { data: { face_verification: faceVerification } } as never;
    }
    if (url === '/profiles/me') return { data: PROFILE_RESPONSE } as never;
    throw notFound();
  });
}

function openVerification() {
  return renderWithProviders(
    <MemoryRouter initialEntries={[VERIFICATION_PATH]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

/** Singura cerere de verificare posibilă e `POST /profiles/verify-face`. */
function watchPost() {
  return vi.spyOn(api, 'post').mockRejectedValue(new Error('no request expected'));
}

let post: ReturnType<typeof watchPost>;

beforeEach(() => {
  useAuthStore.setState({ status: 'idle', user: null, error: null, optimisticName: null });
  post = watchPost();
});

describe('funcția oprită pe server', () => {
  it('ruta directă dă un mesaj scurt, nu fluxul de captură', async () => {
    mockServer(false);
    openVerification();

    expect(await screen.findByTestId('verify-unavailable')).toBeInTheDocument();
    expect(screen.getByText('Verificarea nu este disponibilă')).toBeInTheDocument();
    // Nici urmă de flux: nici buton de pornire, nici alegere de poză, nici video.
    expect(screen.queryByTestId('verify-start')).not.toBeInTheDocument();
    expect(screen.queryByTestId('verify-choose')).not.toBeInTheDocument();
    expect(screen.queryByTestId('verify-file')).not.toBeInTheDocument();
  });

  it('lasă un drum înapoi, nu o fundătură', async () => {
    mockServer(false);
    openVerification();

    const back = await screen.findByTestId('verify-back');
    expect(back).toHaveAttribute('href', '/profil');
  });

  it('nu trimite NICIO cerere de verificare', async () => {
    const get = mockServer(false);
    openVerification();
    await screen.findByTestId('verify-unavailable');

    expect(post).not.toHaveBeenCalled();
    // Nici ecranul de verificare nu e montat, deci nici profilul lui nu se cere.
    expect(get.mock.calls.map((call) => call[0])).not.toContain('/profiles/me');
  });
});

describe('ruta de capabilități nu răspunde', () => {
  it('ascunde funcția în loc să o arate „pe încredere"', async () => {
    mockServer(null);
    openVerification();

    expect(await screen.findByTestId('verify-unavailable', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByTestId('verify-start')).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
});

describe('funcția disponibilă pe server', () => {
  it('fluxul rămâne exact cum era: ecranul complet de verificare', async () => {
    mockServer(true);
    openVerification();

    expect(await screen.findByTestId('verify-start')).toBeInTheDocument();
    expect(screen.getByTestId('verify-privacy')).toBeInTheDocument();
    expect(screen.getByTestId('verify-choose')).toBeInTheDocument();
    expect(screen.queryByTestId('verify-unavailable')).not.toBeInTheDocument();
    // Fluxul nu trimite nimic până nu apasă utilizatorul.
    await waitFor(() => expect(post).not.toHaveBeenCalled());
  });
});
