import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert, Linking } from 'react-native';

import SetariScreen from '../setari';
import { config } from '@/config';
import { ThemeProvider } from '@theme/index';
import type { Settings } from '@/features/settings/settingsApi';

// Linkurile legale se deschid în browser — spionăm, nu deschidem nimic.
const mockOpenURL = jest
  .spyOn(Linking, 'openURL')
  .mockImplementation(() => Promise.resolve(true));

// Mock router (evită navigarea reală expo-router în teste).
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

// Mock store de auth: ecranul citește `user` și `logout`.
// `logout` e legat leneș (`() => mockLogout()`), ca la settingsApi mai jos: obiectul
// ăsta e ridicat de babel deasupra lui `mockLogout`, deci o referință directă ar
// îngheța `undefined` și butonul de deconectare ar părea mort în teste.
const mockLogout = jest.fn(() => Promise.resolve());
const authState = {
  user: { id: 'u1', email: 'nume@exemplu.com' },
  logout: () => mockLogout(),
};
jest.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: typeof authState) => unknown) => selector(authState),
}));

// Mock la settingsApi: fetch controlat + spionăm update / delete.
const baseSettings: Settings = {
  theme: 'light',
  searchRadiusKm: 25,
  notifications: {
    match: true,
    messages: true,
    aiHints: false,
    events: true,
    promos: false,
  },
  profileHidden: false,
  region: 'MD',
  // Preferințele de căutare — `GET /settings` le întoarce mereu.
  interestedIn: ['female'],
  ageMin: 18,
  ageMax: 99,
};
const mockFetchSettings = jest.fn(() => Promise.resolve(baseSettings));
const mockUpdateSettings = jest.fn((_patch: unknown) => Promise.resolve(baseSettings));
const mockRequestDeletion = jest.fn(() =>
  Promise.resolve({ requestedAt: '2026-07-07', purgeAfter: '2026-07-21' }),
);
const mockCancelDeletion = jest.fn(() => Promise.resolve());

jest.mock('@/features/settings/settingsApi', () => ({
  fetchSettings: () => mockFetchSettings(),
  updateSettings: (patch: unknown) => mockUpdateSettings(patch),
  requestAccountDeletion: () => mockRequestDeletion(),
  cancelAccountDeletion: () => mockCancelDeletion(),
}));

// Genurile din secțiunea „Pe cine cauți" vin din referința backendului.
const mockFetchReference = jest.fn(() =>
  Promise.resolve({
    genders: [
      { value: 'male', label: 'Bărbat' },
      { value: 'female', label: 'Femeie' },
    ],
    datingStatuses: [],
    languages: [],
    interests: [],
  }),
);
jest.mock('@/features/anketa/anketaApi', () => ({
  fetchReference: () => mockFetchReference(),
}));

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <SetariScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('SetariScreen', () => {
  beforeEach(() => {
    mockFetchSettings.mockClear();
    mockUpdateSettings.mockClear();
    mockRequestDeletion.mockClear();
    mockCancelDeletion.mockClear();
    mockLogout.mockClear();
    mockFetchReference.mockClear();
  });

  /* --- „Pe cine cauți" (preferințe de căutare) --- */

  describe('secțiunea „Pe cine cauți"', () => {
    it('afișează genurile din referință și trimite cele 3 câmpuri într-un PUT', async () => {
      const { getByTestId, getByText } = renderScreen();

      // Chips-urile de gen vin din backend, nu sunt hardcodate în ecran.
      await waitFor(() => getByTestId('interested-in-male'));
      expect(getByText('Bărbat')).toBeTruthy();
      expect(getByText('Femeie')).toBeTruthy();

      // Setările încărcate pre-selectează „female".
      expect(getByTestId('interested-in-female').props.accessibilityState.selected).toBe(
        true,
      );

      fireEvent.press(getByTestId('interested-in-male'));
      fireEvent.changeText(getByTestId('search-age-min'), '25');
      fireEvent.changeText(getByTestId('search-age-max'), '40');
      fireEvent.press(getByTestId('save-search-prefs'));

      await waitFor(() => {
        expect(mockUpdateSettings).toHaveBeenCalledWith({
          interestedIn: ['female', 'male'],
          ageMin: 25,
          ageMax: 40,
        });
      });
    });

    it('blochează vârsta minimă sub 18 (aplicația este 18+) și nu trimite nimic', async () => {
      const { getByTestId, getByText } = renderScreen();

      await waitFor(() => getByTestId('search-age-min'));
      fireEvent.changeText(getByTestId('search-age-min'), '16');
      fireEvent.press(getByTestId('save-search-prefs'));

      await waitFor(() =>
        getByText('Vârsta minimă nu poate fi sub 18 ani (aplicația este 18+).'),
      );
      // Userul nu are voie să lovească eroarea de la backend.
      expect(mockUpdateSettings).not.toHaveBeenCalled();
    });

    it('ridică vârsta minimă la 18 la ieșirea din câmp (clamp 18+)', async () => {
      const { getByTestId } = renderScreen();

      await waitFor(() => getByTestId('search-age-min'));
      const input = getByTestId('search-age-min');

      fireEvent.changeText(input, '15');
      fireEvent(input, 'endEditing');

      // Câmpul se ridică vizibil la 18, fără să blocheze UI-ul.
      await waitFor(() => expect(getByTestId('search-age-min').props.value).toBe('18'));
    });

    it('respinge intervalul inversat (min > max) cu mesaj clar', async () => {
      const { getByTestId, getByText } = renderScreen();

      await waitFor(() => getByTestId('search-age-min'));
      fireEvent.changeText(getByTestId('search-age-min'), '40');
      fireEvent.changeText(getByTestId('search-age-max'), '30');
      fireEvent.press(getByTestId('save-search-prefs'));

      await waitFor(() =>
        getByText('Vârsta maximă nu poate fi mai mică decât cea minimă.'),
      );
      expect(mockUpdateSettings).not.toHaveBeenCalled();
    });

    it('cere cel puțin un gen ales', async () => {
      const { getByTestId, getByText } = renderScreen();

      // Deselectăm singurul gen preîncărcat („female").
      await waitFor(() => getByTestId('interested-in-female'));
      fireEvent.press(getByTestId('interested-in-female'));
      fireEvent.press(getByTestId('save-search-prefs'));

      await waitFor(() => getByText('Alege cel puțin un gen.'));
      expect(mockUpdateSettings).not.toHaveBeenCalled();
    });
  });

  /* --- Rază de căutare --- */

  it('o editare a razei trimite un SINGUR PUT (onEndEditing + onBlur pe iOS)', async () => {
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('search-radius'));
    const input = getByTestId('search-radius');

    fireEvent.changeText(input, '50');
    // Pe iOS ambele evenimente se declanșează la ieșirea din câmp.
    fireEvent(input, 'endEditing');
    fireEvent(input, 'blur');

    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith({ searchRadiusKm: 50 });
    });
    expect(mockUpdateSettings).toHaveBeenCalledTimes(1);
  });

  it('permite reîncercarea aceleiași raze după un PUT eșuat', async () => {
    mockUpdateSettings.mockRejectedValueOnce(new Error('server picat'));
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('search-radius'));
    const input = getByTestId('search-radius');

    fireEvent.changeText(input, '50');
    fireEvent(input, 'endEditing');
    await waitFor(() => getByTestId('settings-error'));

    // Garda contra dublului PUT nu are voie să înghită reîncercarea userului:
    // pe server raza a rămas tot 25, deci al doilea 50 e o schimbare reală.
    fireEvent(input, 'blur');
    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledTimes(2);
    });
  });

  it('nu trimite nimic dacă raza rămâne neschimbată', async () => {
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('search-radius'));
    const input = getByTestId('search-radius');

    // 25 = valoarea deja salvată în setări.
    fireEvent.changeText(input, '25');
    fireEvent(input, 'endEditing');
    fireEvent(input, 'blur');

    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it('schimbarea temei apelează updateSettings({theme})', async () => {
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('theme-dark'));
    fireEvent.press(getByTestId('theme-dark'));

    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith({ theme: 'dark' });
    });
  });

  it('toggle notificare apelează updateSettings cu patch parțial', async () => {
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('notif-match'));
    fireEvent(getByTestId('notif-match'), 'valueChange', false);

    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        notifications: { match: false },
      });
    });
  });

  it('butonul „Șterge contul" declanșează confirmarea (Alert)', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('delete-account'));
    fireEvent.press(getByTestId('delete-account'));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toBe('Ștergere cont');
    // Cererea de ștergere se trimite doar după confirmare, nu la deschiderea dialogului.
    expect(mockRequestDeletion).not.toHaveBeenCalled();

    alertSpy.mockRestore();
  });

  /* --- Recuperare când ceva pică --- */

  it('păstrează „Deconectare" vizibil când setările nu se încarcă', async () => {
    mockFetchSettings.mockRejectedValueOnce(new Error('server picat'));
    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => getByText('Nu am putut încărca setările.'));

    // Singura cale de ieșire a userului nu are voie să dispară exact la eroare.
    fireEvent.press(getByTestId('logout'));
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it('ștergerea eșuată afișează un mesaj de eroare', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockRequestDeletion.mockRejectedValueOnce(new Error('server picat'));
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('delete-account'));
    fireEvent.press(getByTestId('delete-account'));

    // Confirmăm dialogul (butonul „Șterge contul").
    const confirmBtn = alertSpy.mock.calls[0][2]?.[1];
    confirmBtn?.onPress?.();

    await waitFor(() => {
      expect(alertSpy.mock.calls[1][0]).toBe('Nu am putut șterge contul');
    });

    alertSpy.mockRestore();
  });

  it('anularea eșuată a ștergerii avertizează că ștergerea rămâne programată', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockCancelDeletion.mockRejectedValueOnce(new Error('server picat'));
    const { getByTestId } = renderScreen();

    // Programăm ștergerea ca să apară bannerul cu „Anulează ștergerea".
    await waitFor(() => getByTestId('delete-account'));
    fireEvent.press(getByTestId('delete-account'));
    alertSpy.mock.calls[0][2]?.[1]?.onPress?.();
    await waitFor(() => getByTestId('deletion-banner'));

    fireEvent.press(getByTestId('cancel-deletion'));

    await waitFor(() => {
      expect(alertSpy.mock.calls[1][0]).toBe('Nu am putut anula ștergerea');
    });
    // Bannerul rămâne: ștergerea NU a fost anulată.
    expect(getByTestId('deletion-banner')).toBeTruthy();

    alertSpy.mockRestore();
  });

  /* --- Legal & suport (App Store Guideline 1.2 / 5.1.1) --- */

  it('expune Termenii, Politica de confidențialitate și Suportul', async () => {
    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => getByTestId('link-terms'));
    expect(getByText('Termeni și condiții')).toBeTruthy();
    expect(getByText('Politica de confidențialitate')).toBeTruthy();
    expect(getByText('Suport')).toBeTruthy();
  });

  it('linkurile legale deschid URL-urile din config (nu hardcodate în ecran)', async () => {
    mockOpenURL.mockClear();
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('link-terms'));

    fireEvent.press(getByTestId('link-terms'));
    expect(mockOpenURL).toHaveBeenCalledWith(config.legal.termsUrl);

    fireEvent.press(getByTestId('link-privacy'));
    expect(mockOpenURL).toHaveBeenCalledWith(config.legal.privacyUrl);

    fireEvent.press(getByTestId('link-support'));
    expect(mockOpenURL).toHaveBeenCalledWith(config.legal.supportUrl);
  });
});
