/**
 * Ecranul de profil: încărcare, vizualizare, editare reușită, eroare de la
 * server, validări și confirmarea acțiunii distructive (ștergerea unei poze).
 *
 * Stratul de rețea e mock-uit la nivel de modul — aici testăm ce decide ecranul,
 * nu axios.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VERIFICATION_PATH } from '@/features/verification/verificationRoutes';
import { renderWithProviders } from '@/test/harness';

import { ProfileScreen } from '../ProfileScreen';
import type { MyProfileFull, Reference } from '../profileApi';

/**
 * Capabilitățile sunt mock-uite la nivel de hook, nu de rețea: ecranul trebuie
 * să decidă SINCRON dacă arată intrarea către verificare, altfel testele ar
 * depinde de ordinea în care se rezolvă două cereri fără legătură între ele.
 * Normalizarea răspunsului real e testată în `features/capabilities/__tests__`.
 */
vi.mock('@/features/capabilities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/capabilities')>();
  return { ...actual, useCapability: vi.fn() };
});

const { useCapability } = await import('@/features/capabilities');

/** Serverul spune dacă verificarea prin selfie e disponibilă cu adevărat. */
function setVerificationAvailable(enabled: boolean, isLoading = false) {
  vi.mocked(useCapability).mockReturnValue({ enabled, isLoading, isError: false });
}

vi.mock('../profileApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../profileApi')>();
  return {
    ...actual,
    fetchMyProfile: vi.fn(),
    fetchReference: vi.fn(),
    saveProfile: vi.fn(),
  };
});

vi.mock('../photosApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../photosApi')>();
  return {
    ...actual,
    uploadPhoto: vi.fn(),
    deletePhoto: vi.fn(),
    reorderPhotos: vi.fn(),
  };
});

const { fetchMyProfile, fetchReference, saveProfile } = await import('../profileApi');
const { deletePhoto, reorderPhotos } = await import('../photosApi');

const REFERENCE: Reference = {
  genders: [
    { value: 'f', label: 'Femeie' },
    { value: 'm', label: 'Bărbat' },
  ],
  datingStatuses: [{ value: 'serious', label: 'Relație serioasă' }],
  languages: [
    { value: 'ro', label: 'Română' },
    { value: 'ru', label: 'Русский' },
  ],
  interests: [
    { slug: 'music', label: 'Muzică' },
    { slug: 'hiking', label: 'Drumeții' },
  ],
};

const PHOTOS = ['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg'];

const PROFILE: MyProfileFull = {
  name: 'Ana',
  birthDate: '1996-04-12',
  age: 29,
  gender: 'f',
  heightCm: 168,
  city: 'Chișinău',
  street: 'Centru',
  nationality: 'MD',
  languages: ['ro'],
  about: 'Îmi plac drumețiile.',
  datingStatuses: ['serious'],
  interests: ['music'],
  photos: PHOTOS,
  completed: true,
  verified: true,
  interestedIn: ['m'],
  ageMin: 25,
  ageMax: 40,
};

beforeEach(() => {
  setVerificationAvailable(true);
  vi.mocked(fetchMyProfile).mockResolvedValue(PROFILE);
  vi.mocked(fetchReference).mockResolvedValue(REFERENCE);
  vi.mocked(saveProfile).mockResolvedValue(PROFILE);
  vi.mocked(deletePhoto).mockResolvedValue([PHOTOS[1] as string]);
  vi.mocked(reorderPhotos).mockResolvedValue([PHOTOS[1] as string, PHOTOS[0] as string]);
});

/**
 * Randează ecranul într-un router de memorie: de când profilul neverificat
 * arată intrarea către verificare (`<Link>`), fără router randarea ar arunca.
 */
function renderScreen() {
  return renderWithProviders(
    <MemoryRouter>
      <ProfileScreen />
    </MemoryRouter>,
  );
}

/** Randează ecranul și așteaptă terminarea încărcării. */
async function renderProfile() {
  renderScreen();
  await screen.findByRole('heading', { level: 1 });
}

describe('încărcare și vizualizare', () => {
  it('arată întâi starea de încărcare, apoi profilul', async () => {
    renderScreen();
    expect(screen.getByRole('status')).toBeInTheDocument();

    expect(await screen.findByRole('heading', { name: 'Ana' })).toBeInTheDocument();
    expect(screen.getByText('29 · Chișinău')).toBeInTheDocument();
    // Etichetele vin din catalogul serverului, NU sunt hardcodate în ecran.
    expect(screen.getByText('Femeie')).toBeInTheDocument();
    expect(screen.getByText('Muzică')).toBeInTheDocument();
    expect(screen.getByText('Relație serioasă')).toBeInTheDocument();
    expect(screen.getByText('Îmi plac drumețiile.')).toBeInTheDocument();
    // Pozele profilului, în ordine.
    expect(screen.getByTestId('profile-gallery').querySelectorAll('img')).toHaveLength(2);
  });

  it('arată badge-ul de verificare doar când serverul a confirmat-o', async () => {
    await renderProfile();
    expect(screen.getByTestId('verified-badge')).toBeInTheDocument();
    expect(screen.queryByTestId('unverified-hint')).not.toBeInTheDocument();
  });

  /**
   * Contul deja verificat NU primește butonul către flux: a trecut o dată prin
   * selfie, nu are de ce să o ia de la capăt.
   */
  it('nu trimite contul deja verificat înapoi în fluxul de verificare', async () => {
    await renderProfile();
    expect(screen.queryByTestId('verify-cta')).not.toBeInTheDocument();
  });

  it('arată indiciul de verificare pentru un cont neverificat', async () => {
    vi.mocked(fetchMyProfile).mockResolvedValue({ ...PROFILE, verified: false });
    await renderProfile();
    expect(screen.getByTestId('unverified-hint')).toBeInTheDocument();
    expect(screen.queryByTestId('verified-badge')).not.toBeInTheDocument();
  });

  it('dă contului neverificat un drum către flux, nu doar un text', async () => {
    vi.mocked(fetchMyProfile).mockResolvedValue({ ...PROFILE, verified: false });
    await renderProfile();
    const cta = screen.getByTestId('verify-cta');
    expect(cta).toHaveAttribute('href', VERIFICATION_PATH);
  });

  /**
   * Verificarea prin selfie era desfășurată cu providerul `stub` pe server:
   * întorcea „verificat" pentru oricine. Cât timp funcția nu e reală, intrarea
   * spre ea nu are voie să apară pe profil — un buton care promite o insignă de
   * încredere fără să o merite e mai rău decât lipsa funcției.
   */
  describe('verificarea oprită pe server', () => {
    it('nu arată nici indiciul, nici butonul către flux', async () => {
      setVerificationAvailable(false);
      vi.mocked(fetchMyProfile).mockResolvedValue({ ...PROFILE, verified: false });
      await renderProfile();

      expect(screen.queryByTestId('unverified-hint')).not.toBeInTheDocument();
      expect(screen.queryByTestId('verify-cta')).not.toBeInTheDocument();
      // Restul profilului rămâne întreg — ascundem o funcție, nu un ecran.
      expect(screen.getByTestId('start-edit')).toBeInTheDocument();
    });

    it('PĂSTREAZĂ badge-ul conturilor deja verificate', async () => {
      // Oprirea privește câștigarea insignei de acum înainte, nu retragerea
      // celor deja acordate: statutul e al serverului, nu al clientului.
      setVerificationAvailable(false);
      await renderProfile();

      expect(screen.getByTestId('verified-badge')).toBeInTheDocument();
    });

    it('ascunde intrarea și cât timp serverul încă nu a răspuns', async () => {
      setVerificationAvailable(false, true);
      vi.mocked(fetchMyProfile).mockResolvedValue({ ...PROFILE, verified: false });
      await renderProfile();

      expect(screen.queryByTestId('verify-cta')).not.toBeInTheDocument();
    });
  });

  it('arată eroarea de încărcare și permite reîncercarea', async () => {
    vi.mocked(fetchMyProfile).mockRejectedValueOnce(new Error('offline'));
    renderScreen();

    const retry = await screen.findByRole('button', { name: 'Reîncearcă' });
    await userEvent.click(retry);

    expect(await screen.findByRole('heading', { name: 'Ana' })).toBeInTheDocument();
  });

  it('deschide direct formularul când anketa încă nu există (404 → null)', async () => {
    vi.mocked(fetchMyProfile).mockResolvedValue(null);
    await renderProfile();

    expect(screen.getByTestId('field-name')).toBeInTheDocument();
    // Fără profil salvat nu are ce anula — butonul de renunțare lipsește.
    expect(screen.queryByTestId('cancel-edit')).not.toBeInTheDocument();
  });
});

describe('editare', () => {
  /** Trece ecranul în modul de editare. */
  async function startEditing() {
    await renderProfile();
    await userEvent.click(screen.getByTestId('start-edit'));
    return screen.getByTestId('field-name');
  }

  it('pre-completează formularul cu datele de pe server', async () => {
    const name = await startEditing();
    expect(name).toHaveValue('Ana');
    expect(screen.getByTestId('field-city')).toHaveValue('Chișinău');
    expect(screen.getByTestId('field-height')).toHaveValue('168');
    expect(screen.getByTestId('field-birth-date')).toHaveValue('1996-04-12');
    expect(screen.getByTestId('gender-f')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('interest-music')).toHaveAttribute('aria-pressed', 'true');
  });

  it('salvează modificările și trimite ÎNTOTDEAUNA pozele curente', async () => {
    const name = await startEditing();

    await userEvent.clear(name);
    await userEvent.type(name, 'Ana Maria');
    await userEvent.click(screen.getByTestId('interest-hiking'));
    await userEvent.click(screen.getByTestId('save-profile'));

    await waitFor(() => expect(saveProfile).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveProfile).mock.calls[0]?.[0]).toMatchObject({
      name: 'Ana Maria',
      interests: ['music', 'hiking'],
      // Fără `photos` în payload, `PUT /profiles/me` ar șterge toate pozele.
      photos: PHOTOS,
    });

    // După salvare revenim la vizualizare.
    expect(await screen.findByTestId('start-edit')).toBeInTheDocument();
  });

  it('blochează salvarea când un câmp obligatoriu e gol', async () => {
    const name = await startEditing();
    await userEvent.clear(name);
    await userEvent.click(screen.getByTestId('save-profile'));

    expect(await screen.findByText('Introdu numele tău.')).toBeInTheDocument();
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it('respinge înălțimea în afara intervalului acceptat de backend', async () => {
    await startEditing();
    const height = screen.getByTestId('field-height');
    await userEvent.clear(height);
    await userEvent.type(height, '20');
    await userEvent.click(screen.getByTestId('save-profile'));

    expect(saveProfile).not.toHaveBeenCalled();
    expect(screen.getByTestId('field-height').parentElement).toHaveTextContent(/înălțime/i);
  });

  it('respinge marcajele HTML în text (anti-XSS, simetric cu backendul)', async () => {
    const name = await startEditing();
    await userEvent.clear(name);
    await userEvent.type(name, '<script>x</script>');
    await userEvent.click(screen.getByTestId('save-profile'));

    expect(saveProfile).not.toHaveBeenCalled();
  });

  it('arată eroarea de la server fără să părăsească formularul', async () => {
    vi.mocked(saveProfile).mockRejectedValueOnce(new Error('500'));
    await startEditing();

    await userEvent.click(screen.getByTestId('save-profile'));

    expect(await screen.findByTestId('save-error')).toHaveTextContent(
      'Nu am putut salva profilul. Încearcă din nou.',
    );
    expect(screen.getByTestId('field-name')).toBeInTheDocument();
  });

  it('renunțarea repune valorile de pe server', async () => {
    const name = await startEditing();
    await userEvent.clear(name);
    await userEvent.type(name, 'Altceva');
    await userEvent.click(screen.getByTestId('cancel-edit'));

    expect(await screen.findByTestId('start-edit')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('start-edit'));
    expect(screen.getByTestId('field-name')).toHaveValue('Ana');
  });
});

describe('gestionarea pozelor', () => {
  async function startEditing() {
    await renderProfile();
    await userEvent.click(screen.getByTestId('start-edit'));
  }

  it('cere confirmare ÎNAINTE de ștergere și nu folosește dialogul browserului', async () => {
    // `window.confirm` blochează WebView-ul Telegram: nu are voie să fie chemat.
    const nativeConfirm = vi.spyOn(window, 'confirm');
    await startEditing();

    await userEvent.click(screen.getByTestId('photo-remove-0'));

    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    expect(deletePhoto).not.toHaveBeenCalled();
    expect(nativeConfirm).not.toHaveBeenCalled();
    // Prima poză dispare ⇒ utilizatorul e avertizat că își pierde poza principală.
    expect(screen.getByTestId('confirm-dialog')).toHaveTextContent(
      'Este poza ta principală.',
    );
  });

  it('anularea confirmării lasă poza pe loc', async () => {
    await startEditing();
    await userEvent.click(screen.getByTestId('photo-remove-1'));
    await userEvent.click(screen.getByTestId('confirm-cancel'));

    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    expect(deletePhoto).not.toHaveBeenCalled();
  });

  it('șterge poza abia după confirmare', async () => {
    await startEditing();
    await userEvent.click(screen.getByTestId('photo-remove-0'));
    await userEvent.click(screen.getByTestId('confirm-accept'));

    await waitFor(() => expect(deletePhoto).toHaveBeenCalledWith(PHOTOS[0]));
    // Grila arată exact lista întoarsă de server, fără poza ștearsă.
    await waitFor(() => expect(screen.queryByTestId('photo-tile-1')).not.toBeInTheDocument());
    expect(screen.getByTestId('photo-tile-0').querySelector('img')).toHaveAttribute(
      'src',
      PHOTOS[1],
    );
    expect(screen.queryByTestId('photos-error')).not.toBeInTheDocument();
  });

  it('arată eroarea când ștergerea eșuează pe server', async () => {
    vi.mocked(deletePhoto).mockRejectedValueOnce(new Error('boom'));
    await startEditing();

    await userEvent.click(screen.getByTestId('photo-remove-0'));
    await userEvent.click(screen.getByTestId('confirm-accept'));

    expect(await screen.findByTestId('photos-error')).toHaveTextContent(
      'Nu am putut șterge poza. Încearcă din nou.',
    );
  });

  it('reordonează optimist și revine la ordinea serverului dacă PUT-ul pică', async () => {
    vi.mocked(reorderPhotos).mockRejectedValueOnce(new Error('boom'));
    await startEditing();

    await userEvent.click(screen.getByTestId('photo-later-0'));

    await waitFor(() => expect(reorderPhotos).toHaveBeenCalledWith([PHOTOS[1], PHOTOS[0]]));
    expect(await screen.findByTestId('photos-error')).toHaveTextContent(
      'Nu am putut salva ordinea pozelor. Încearcă din nou.',
    );
    // Ordinea afișată e din nou cea reală de pe server.
    const first = screen.getByTestId('photo-tile-0').querySelector('img');
    expect(first).toHaveAttribute('src', PHOTOS[0]);
  });

  it('salvează noua ordine când serverul o acceptă', async () => {
    await startEditing();
    await userEvent.click(screen.getByTestId('photo-later-0'));

    await waitFor(() => expect(reorderPhotos).toHaveBeenCalledWith([PHOTOS[1], PHOTOS[0]]));
    await waitFor(() => {
      const first = screen.getByTestId('photo-tile-0').querySelector('img');
      expect(first).toHaveAttribute('src', PHOTOS[1]);
    });
  });
});
