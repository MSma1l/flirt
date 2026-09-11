/**
 * Ecranul de Setări: încărcare, salvare reușită, eroare de la server, validarea
 * preferințelor de căutare și confirmarea acțiunii distructive (ștergerea
 * contului + anularea ei).
 *
 * Stratul de rețea REUTILIZAT din aplicația Expo e mock-uit la nivel de modul.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Settings } from '@mobile/features/settings/settingsApi';

import { renderWithProviders } from '@/test/harness';

import type { Reference } from '../../profile/profileApi';
import { SettingsScreen } from '../SettingsScreen';

vi.mock('@mobile/features/settings/settingsApi', () => ({
  fetchSettings: vi.fn(),
  updateSettings: vi.fn(),
  requestAccountDeletion: vi.fn(),
  cancelAccountDeletion: vi.fn(),
}));

vi.mock('../../profile/profileApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../profile/profileApi')>();
  return { ...actual, fetchReference: vi.fn() };
});

const { fetchSettings, updateSettings, requestAccountDeletion, cancelAccountDeletion } =
  await import('@mobile/features/settings/settingsApi');
const { fetchReference } = await import('../../profile/profileApi');

const REFERENCE: Reference = {
  genders: [
    { value: 'f', label: 'Femeie' },
    { value: 'm', label: 'Bărbat' },
  ],
  datingStatuses: [],
  languages: [],
  interests: [],
};

const SETTINGS: Settings = {
  theme: 'dark',
  searchRadiusKm: 50,
  notifications: { match: true, messages: true, aiHints: false, events: true, promos: false },
  profileHidden: false,
  region: 'MD',
  interestedIn: ['m'],
  ageMin: 22,
  ageMax: 35,
};

beforeEach(() => {
  vi.mocked(fetchSettings).mockResolvedValue(SETTINGS);
  vi.mocked(fetchReference).mockResolvedValue(REFERENCE);
  vi.mocked(updateSettings).mockResolvedValue(SETTINGS);
  vi.mocked(requestAccountDeletion).mockResolvedValue({
    requestedAt: '2026-09-11T10:00:00Z',
    purgeAfter: '2026-10-11T10:00:00Z',
  });
  vi.mocked(cancelAccountDeletion).mockResolvedValue(undefined);
});

async function renderSettings() {
  renderWithProviders(<SettingsScreen />);
  await screen.findByRole('heading', { level: 1, name: 'Setări' });
}

describe('încărcare', () => {
  it('arată întâi starea de încărcare, apoi setările de pe server', async () => {
    renderWithProviders(<SettingsScreen />);
    expect(screen.getByRole('status')).toBeInTheDocument();

    await screen.findByRole('heading', { level: 1, name: 'Setări' });
    expect(screen.getByTestId('search-radius')).toHaveValue('50');
    expect(screen.getByTestId('search-age-min')).toHaveValue('22');
    expect(screen.getByTestId('search-age-max')).toHaveValue('35');
    expect(screen.getByTestId('notif-match')).toBeChecked();
    expect(screen.getByTestId('notif-aiHints')).not.toBeChecked();
    expect(screen.getByTestId('profile-hidden')).not.toBeChecked();
    // Genurile vin din referința serverului, nu sunt hardcodate în ecran.
    expect(screen.getByTestId('interested-in-m')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('interested-in-f')).toHaveAttribute('aria-pressed', 'false');
  });

  it('arată eroarea de încărcare și permite reîncercarea', async () => {
    vi.mocked(fetchSettings).mockRejectedValueOnce(new Error('offline'));
    renderWithProviders(<SettingsScreen />);

    await userEvent.click(await screen.findByRole('button', { name: 'Reîncearcă' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Setări' })).toBeInTheDocument();
  });
});

describe('comutatoare și preferințe', () => {
  it('trimite un patch parțial la comutarea unei notificări', async () => {
    await renderSettings();
    await userEvent.click(screen.getByTestId('notif-match'));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ notifications: { match: false } }),
    );
  });

  it('trimite `profileHidden` la ascunderea profilului', async () => {
    await renderSettings();
    await userEvent.click(screen.getByTestId('profile-hidden'));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ profileHidden: true }));
  });

  it('salvează preferințele de căutare validate', async () => {
    await renderSettings();
    await userEvent.click(screen.getByTestId('interested-in-f'));
    await userEvent.click(screen.getByTestId('save-search-prefs'));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        interestedIn: ['m', 'f'],
        ageMin: 22,
        ageMax: 35,
      }),
    );
  });

  it('trimite tot spectrul adult când „fără interval de vârstă" e pornit', async () => {
    await renderSettings();
    await userEvent.click(screen.getByTestId('search-any-age'));
    expect(screen.queryByTestId('search-age-min')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('save-search-prefs'));
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        interestedIn: ['m'],
        ageMin: 18,
        ageMax: 120,
      }),
    );
  });

  it('refuză un interval inversat, fără să atingă serverul', async () => {
    await renderSettings();
    const max = screen.getByTestId('search-age-max');
    await userEvent.clear(max);
    await userEvent.type(max, '19');
    await userEvent.click(screen.getByTestId('save-search-prefs'));

    expect(
      await screen.findByText('Vârsta maximă nu poate fi mai mică decât cea minimă.'),
    ).toBeInTheDocument();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('ridică la 18 o vârstă minimă sub prag (aplicația este 18+)', async () => {
    await renderSettings();
    const min = screen.getByTestId('search-age-min');
    await userEvent.clear(min);
    await userEvent.type(min, '15');
    await userEvent.tab(); // blur → clamp

    await waitFor(() => expect(screen.getByTestId('search-age-min')).toHaveValue('18'));
  });

  it('refuză cel puțin un gen căutat', async () => {
    await renderSettings();
    await userEvent.click(screen.getByTestId('interested-in-m')); // îl deselectăm
    await userEvent.click(screen.getByTestId('save-search-prefs'));

    expect(await screen.findByTestId('interested-in-error')).toHaveTextContent(
      'Alege cel puțin un gen.',
    );
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('validează raza de căutare local, înainte de PUT', async () => {
    await renderSettings();
    const radius = screen.getByTestId('search-radius');
    await userEvent.clear(radius);
    await userEvent.type(radius, '99999');
    await userEvent.tab();

    expect(await screen.findByTestId('radius-error')).toBeInTheDocument();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('trimite raza schimbată o SINGURĂ dată', async () => {
    await renderSettings();
    const radius = screen.getByTestId('search-radius');
    await userEvent.clear(radius);
    await userEvent.type(radius, '80');
    await userEvent.tab();

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ searchRadiusKm: 80 }));
    expect(updateSettings).toHaveBeenCalledTimes(1);
  });

  it('arată eroarea de salvare când serverul refuză', async () => {
    vi.mocked(updateSettings).mockRejectedValueOnce(new Error('500'));
    await renderSettings();

    await userEvent.click(screen.getByTestId('notif-promos'));

    expect(await screen.findByTestId('settings-error')).toHaveTextContent(
      'Nu am putut salva setarea.',
    );
  });
});

describe('limba', () => {
  it('comută interfața în limba aleasă', async () => {
    await renderSettings();
    expect(screen.getByTestId('language-ro')).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByTestId('language-en'));

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    // Punem limba la loc: instanța i18n e comună tuturor testelor din proces.
    await userEvent.click(screen.getByTestId('language-ro'));
    await screen.findByRole('heading', { level: 1, name: 'Setări' });
  });
});

describe('ștergerea contului', () => {
  it('cere confirmare proprie și NU cheamă dialogul browserului', async () => {
    const nativeConfirm = vi.spyOn(window, 'confirm');
    await renderSettings();

    await userEvent.click(screen.getByTestId('delete-account'));

    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    expect(requestAccountDeletion).not.toHaveBeenCalled();
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it('anularea confirmării nu trimite nimic', async () => {
    await renderSettings();
    await userEvent.click(screen.getByTestId('delete-account'));
    await userEvent.click(screen.getByTestId('confirm-cancel'));

    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    expect(requestAccountDeletion).not.toHaveBeenCalled();
  });

  it('cere ștergerea după confirmare și arată perioada de grație', async () => {
    await renderSettings();
    await userEvent.click(screen.getByTestId('delete-account'));
    await userEvent.click(screen.getByTestId('confirm-accept'));

    await waitFor(() => expect(requestAccountDeletion).toHaveBeenCalledTimes(1));
    const banner = await screen.findByTestId('deletion-banner');
    expect(banner).toHaveTextContent('Ștergere programată');
    // Data de purjare, formatată în limba activă.
    expect(banner).toHaveTextContent(new Date('2026-10-11T10:00:00Z').toLocaleDateString('ro'));
    // Cât timp ștergerea e programată, butonul distructiv rămâne blocat.
    expect(screen.getByTestId('delete-account')).toBeDisabled();
  });

  it('anulează ștergerea programată', async () => {
    await renderSettings();
    await userEvent.click(screen.getByTestId('delete-account'));
    await userEvent.click(screen.getByTestId('confirm-accept'));
    await screen.findByTestId('deletion-banner');

    await userEvent.click(screen.getByTestId('cancel-deletion'));

    await waitFor(() => expect(cancelAccountDeletion).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByTestId('deletion-banner')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('delete-account')).toBeEnabled();
  });

  it('avertizează când anularea eșuează — ștergerea rămâne programată', async () => {
    vi.mocked(cancelAccountDeletion).mockRejectedValueOnce(new Error('500'));
    await renderSettings();
    await userEvent.click(screen.getByTestId('delete-account'));
    await userEvent.click(screen.getByTestId('confirm-accept'));
    await screen.findByTestId('deletion-banner');

    await userEvent.click(screen.getByTestId('cancel-deletion'));

    expect(await screen.findByTestId('cancel-deletion-error')).toBeInTheDocument();
    expect(screen.getByTestId('deletion-banner')).toBeInTheDocument();
  });

  it('arată eroarea când cererea de ștergere nu ajunge la server', async () => {
    vi.mocked(requestAccountDeletion).mockRejectedValueOnce(new Error('offline'));
    await renderSettings();

    await userEvent.click(screen.getByTestId('delete-account'));
    await userEvent.click(screen.getByTestId('confirm-accept'));

    expect(await screen.findByTestId('delete-account-error')).toBeInTheDocument();
    expect(screen.queryByTestId('deletion-banner')).not.toBeInTheDocument();
  });
});
