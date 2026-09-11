/**
 * Fluxul complet de înregistrare, de la butonul de bun venit până în feed.
 *
 * Testul urmărește exact drumul cerut de proprietar: intru din bot, apăs UN
 * buton, datele Telegramului sunt deja acolo, completez ce lipsește, urc
 * pozele, intru în aplicație.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/api/client';
import { useAuthStore } from '@/auth/authStore';
import { AppRoutes } from '@/routes';
import { installTelegramStub } from '@/test/telegramStub';

import { httpError, REFERENCE_RESPONSE, renderRouted } from './testUtils';

// jsdom nu are nici `createImageBitmap`, nici `canvas.toBlob`, deci pregătirea
// pozei se testează separat, cu decodare/encodare injectate
// (`imageCompress.test.ts`). Aici ne interesează drumul, nu compresia.
vi.mock('../imageCompress', () => ({
  browserIo: {},
  compressImage: vi.fn(async () => ({
    ok: true,
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    fileName: 'photo.jpg',
    width: 1080,
    height: 1440,
  })),
}));

vi.mock('@mobile/features/feed/feedApi', () => ({
  fetchFeed: vi.fn(async () => []),
  swipe: vi.fn(),
  undoSwipe: vi.fn(),
}));

/** Starea serverului fals, cât să acopere onboardingul. */
interface FakeServer {
  completed: boolean;
  profile: Record<string, unknown> | null;
  photos: string[];
}

let server: FakeServer;

function installApiMocks() {
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/auth/me') {
      return {
        data: { id: 'u1', email: 'a@b.c', profile_completed: server.completed },
      } as never;
    }
    if (url === '/profiles/reference') return { data: REFERENCE_RESPONSE } as never;
    if (url === '/profiles/me') {
      if (!server.profile) throw httpError(404, 'Anketa nu există încă.');
      return { data: { ...server.profile, photos: server.photos } } as never;
    }
    throw httpError(404);
  });

  vi.spyOn(api, 'put').mockImplementation(async (url: string, body?: unknown) => {
    if (url !== '/profiles/me') throw httpError(404);
    server.profile = body as Record<string, unknown>;
    return { data: { ...server.profile, photos: server.photos } } as never;
  });

  vi.spyOn(api, 'post').mockImplementation(async (url: string) => {
    if (url !== '/profiles/photos') throw httpError(404);
    server.photos = [...server.photos, `https://cdn.test/p${server.photos.length + 1}.jpg`];
    // Backendul recalculează singur flagul: anketă completă + destule poze.
    if (server.profile && server.photos.length >= 2) server.completed = true;
    return { data: server.photos } as never;
  });
}

/** Grupul „Gen" — cel al utilizatorului, nu cel al preferințelor de căutare. */
function genderGroup(): HTMLElement {
  return screen.getByRole('group', { name: /^Gen/ });
}

/** Completează câmpurile obligatorii ale formularului. */
function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/Data nașterii/), {
    target: { value: '1996-05-20' },
  });
  fireEvent.change(screen.getByLabelText(/Înălțime/), { target: { value: '175' } });
  fireEvent.change(screen.getByLabelText(/Oraș/), { target: { value: 'Chișinău' } });
  // „Bărbat" apare în DOUĂ grupuri (genul propriu și „pe cine cauți"), fiindcă
  // ambele folosesc același catalog de genuri. Căutăm în grupul potrivit.
  fireEvent.click(within(genderGroup()).getByRole('button', { name: 'Bărbat' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sport' }));
}

/** Alege un fișier în input-ul de poze. */
function pickPhoto() {
  const input = screen.getByTestId('photos-input');
  const file = new File(['x'], 'poza.jpg', { type: 'image/jpeg' });
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  server = { completed: false, profile: null, photos: [] };
  useAuthStore.setState({ status: 'idle', user: null, error: null, optimisticName: null });
  installTelegramStub();
  installApiMocks();
});

describe('înregistrare completă', () => {
  it('un buton, datele Telegramului precompletate, apoi profil + poze → feed', async () => {
    renderRouted(<AppRoutes />);

    // 1. Bun venit: numele din Telegram e pe ecran, iar butonul e unul singur.
    expect(await screen.findByText(/Ana/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('welcome-cta'));

    // 2. Formular: numele vine deja completat din Telegram, limba la fel.
    const name = (await screen.findByLabelText(/Nume/)) as HTMLInputElement;
    expect(name.value).toBe('Ana');
    expect(screen.getByRole('button', { name: 'Română' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fillRequiredFields();
    fireEvent.click(screen.getByTestId('form-submit'));

    // 3. Anketa pleacă în snake_case, cu vârsta și catalogul cerute de backend.
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.put).mock.calls[0]?.[1]).toMatchObject({
      name: 'Ana',
      birth_date: '1996-05-20',
      gender: 'male',
      height_cm: 175,
      city: 'Chișinău',
      languages: ['ro'],
      interests: ['sport'],
      // Lista de poze se trimite ÎNTOTDEAUNA: ruta o rescrie.
      photos: [],
    });

    // 4. Pozele: minimul cerut de backend, cu mesaj explicit cât mai lipsește.
    expect(await screen.findByTestId('photos-add')).toBeInTheDocument();
    expect(screen.getByText(/Mai adaugă 2 poze/)).toBeInTheDocument();
    expect(screen.getByTestId('photos-finish')).toBeDisabled();

    pickPhoto();
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    pickPhoto();
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));

    // 5. Final: serverul confirmă `profile_completed`, poarta deschide aplicația.
    await waitFor(() => expect(screen.getByTestId('photos-finish')).toBeEnabled());
    fireEvent.click(screen.getByTestId('photos-finish'));

    expect(await screen.findByRole('navigation')).toBeInTheDocument();
  });

  it('nu trimite nimic dacă vârsta e sub 18 și spune clar de ce', async () => {
    renderRouted(<AppRoutes />);
    fireEvent.click(await screen.findByTestId('welcome-cta'));
    await screen.findByLabelText(/Nume/);

    fillRequiredFields();
    const currentYear = new Date().getUTCFullYear();
    fireEvent.change(screen.getByLabelText(/Data nașterii/), {
      target: { value: `${currentYear - 15}-01-01` },
    });
    fireEvent.click(screen.getByTestId('form-submit'));

    expect(
      await screen.findByText(/trebuie să ai cel puțin 18 ani/i),
    ).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('cere cel puțin un interes — regulă de business a backendului', async () => {
    renderRouted(<AppRoutes />);
    fireEvent.click(await screen.findByTestId('welcome-cta'));
    await screen.findByLabelText(/Nume/);

    fillRequiredFields();
    // Deselectăm interesul ales de `fillRequiredFields`.
    fireEvent.click(screen.getByRole('button', { name: 'Sport' }));
    fireEvent.click(screen.getByTestId('form-submit'));

    expect(await screen.findByText('Alege cel puțin un interes.')).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });
  it('leagă butonul principal NATIV al Telegramului la aceeași acțiune', async () => {
    const { webApp } = installTelegramStub();

    renderRouted(<AppRoutes />);
    await screen.findByTestId('welcome-cta');

    // Hook-ul `useTelegramMainButton` exista, dar nu era folosit nicăieri.
    expect(webApp.MainButton.setText).toHaveBeenCalledWith('Continuă cu Telegram');
    expect(webApp.MainButton.show).toHaveBeenCalled();
  });
});

describe('erori de la server', () => {
  it('arată motivul exact al respingerii anketei (422 cu detaliu)', async () => {
    vi.mocked(api.put).mockRejectedValue(
      httpError(422, 'Selectează cel puțin un interes valid.'),
    );

    renderRouted(<AppRoutes />);
    fireEvent.click(await screen.findByTestId('welcome-cta'));
    await screen.findByLabelText(/Nume/);
    fillRequiredFields();
    fireEvent.click(screen.getByTestId('form-submit'));

    expect(await screen.findByTestId('form-error')).toHaveTextContent(
      'Selectează cel puțin un interes valid.',
    );
    // Rămânem pe formular: utilizatorul poate corecta și retrimite.
    expect(screen.getByTestId('form-submit')).toBeInTheDocument();
  });

  it('arată motivul respingerii unei poze (moderare) fără să piardă ecranul', async () => {
    renderRouted(<AppRoutes />);
    fireEvent.click(await screen.findByTestId('welcome-cta'));
    await screen.findByLabelText(/Nume/);
    fillRequiredFields();
    fireEvent.click(screen.getByTestId('form-submit'));
    await screen.findByTestId('photos-add');

    vi.mocked(api.post).mockRejectedValue(
      httpError(422, 'Poza conține nuditate explicită și nu poate fi publicată.'),
    );
    pickPhoto();

    expect(await screen.findByTestId('photos-error')).toHaveTextContent(
      'Poza conține nuditate explicită',
    );
    expect(screen.getByTestId('photos-add')).toBeInTheDocument();
  });

  it('o poză peste limita serverului (413) primește un mesaj despre mărime', async () => {
    renderRouted(<AppRoutes />);
    fireEvent.click(await screen.findByTestId('welcome-cta'));
    await screen.findByLabelText(/Nume/);
    fillRequiredFields();
    fireEvent.click(screen.getByTestId('form-submit'));
    await screen.findByTestId('photos-add');

    vi.mocked(api.post).mockRejectedValue(httpError(413));
    pickPhoto();

    expect(await screen.findByTestId('photos-error')).toHaveTextContent('8 MB');
  });

  it('fără rețea spune că lipsește legătura, nu că poza e greșită', async () => {
    renderRouted(<AppRoutes />);
    fireEvent.click(await screen.findByTestId('welcome-cta'));
    await screen.findByLabelText(/Nume/);
    fillRequiredFields();
    fireEvent.click(screen.getByTestId('form-submit'));
    await screen.findByTestId('photos-add');

    const { networkError } = await import('./testUtils');
    vi.mocked(api.post).mockRejectedValue(networkError());
    pickPhoto();

    expect(await screen.findByTestId('photos-error')).toHaveTextContent(
      'Nu avem legătură cu serverul',
    );
  });

  it('dacă serverul tot nu confirmă profilul, nu aruncă utilizatorul în feed', async () => {
    renderRouted(<AppRoutes />);
    fireEvent.click(await screen.findByTestId('welcome-cta'));
    await screen.findByLabelText(/Nume/);
    fillRequiredFields();
    fireEvent.click(screen.getByTestId('form-submit'));
    await screen.findByTestId('photos-add');

    pickPhoto();
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    pickPhoto();
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));

    // Serverul se răzgândește: profilul NU e complet.
    server.completed = false;
    await waitFor(() => expect(screen.getByTestId('photos-finish')).toBeEnabled());
    fireEvent.click(screen.getByTestId('photos-finish'));

    expect(await screen.findByTestId('photos-error')).toHaveTextContent(
      'profilul încă nu e complet',
    );
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});
