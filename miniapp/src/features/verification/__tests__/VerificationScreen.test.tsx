/**
 * Ecranul de verificare: cele două căi de captură, trecerea automată de la
 * prima la a doua, și ce vede utilizatorul la fiecare răspuns al serverului.
 *
 * CE E REAL AICI, deliberat: modulul de cameră (`selfieCamera`) NU e mock-uit.
 * Testele îi pun în față un `navigator` fabricat — cu `mediaDevices` lipsă, cu
 * `getUserMedia` care refuză, cu o cameră care nu pornește — fiindcă exact
 * detecția aia e partea care se strică în WebView-ul Telegram, iar un mock peste
 * ea ar testa mock-ul.
 *
 * CE E MOCK-UIT: rețeaua (`faceVerifyApi`, `profileApi`) și micșorarea imaginii
 * (`selfieUpload`, testată separat, și care are nevoie de un encoder real).
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/harness';

import type { MyProfileFull } from '@/features/profile/profileApi';

vi.mock('@/features/profile/profileApi', () => ({ fetchMyProfile: vi.fn() }));
vi.mock('../selfieUpload', () => ({ prepareSelfie: vi.fn() }));
vi.mock('../faceVerifyApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../faceVerifyApi')>();
  return { ...actual, verifyFace: vi.fn() };
});

const { fetchMyProfile } = await import('@/features/profile/profileApi');
const { prepareSelfie } = await import('../selfieUpload');
const { FaceVerifyError, verifyFace } = await import('../faceVerifyApi');
const { VerificationScreen } = await import('../VerificationScreen');

/* ————————————————————————— unelte ————————————————————————— */

const PROFILE: MyProfileFull = {
  name: 'Ana',
  birthDate: '1996-05-04',
  age: 29,
  gender: 'female',
  heightCm: 170,
  city: 'Chisinau',
  languages: ['ro'],
  datingStatuses: ['serious'],
  interests: ['music'],
  photos: ['https://cdn.example/photos/1.jpg', 'https://cdn.example/photos/2.jpg'],
  completed: true,
  verified: false,
  interestedIn: ['male'],
  ageMin: 20,
  ageMax: 40,
};

const SELFIE = new Blob(['octeti'], { type: 'image/jpeg' });

/** Pistele fluxului fals, ca să putem verifica oprirea camerei. */
let tracks: { stop: ReturnType<typeof vi.fn> }[] = [];

function fakeStream(): MediaStream {
  tracks = [{ stop: vi.fn() }];
  return { getTracks: () => tracks } as unknown as MediaStream;
}

/** Înlocuiește `navigator.mediaDevices` / `navigator.permissions` pentru un test. */
function setNavigator(parts: {
  getUserMedia?: unknown;
  mediaDevices?: unknown;
  permission?: string;
}) {
  const mediaDevices =
    'mediaDevices' in parts ? parts.mediaDevices : { getUserMedia: parts.getUserMedia };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: mediaDevices,
  });
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: parts.permission
      ? { query: vi.fn().mockResolvedValue({ state: parts.permission }) }
      : undefined,
  });
}

function render() {
  return renderWithProviders(
    <MemoryRouter>
      <VerificationScreen />
    </MemoryRouter>,
  );
}

/** Randează și așteaptă profilul. */
async function renderReady() {
  const utils = render();
  await screen.findByTestId('verify-start');
  return utils;
}

/**
 * Duce fluxul până la previzualizarea camerei vii: apasă butonul, apoi anunță
 * elementul `<video>` că are metadate (altfel `waitForVideo` ar expira).
 */
async function openCamera() {
  await userEvent.click(screen.getByTestId('verify-start'));
  const video = await screen.findByTestId('verify-video');
  Object.defineProperty(video, 'videoWidth', { configurable: true, value: 720 });
  Object.defineProperty(video, 'videoHeight', { configurable: true, value: 1280 });
  fireEvent(video, new Event('loadedmetadata'));
  return video as HTMLVideoElement;
}

let clickSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.mocked(fetchMyProfile).mockResolvedValue(PROFILE);
  vi.mocked(prepareSelfie).mockResolvedValue({
    ok: true,
    blob: SELFIE,
    fileName: 'selfie.jpg',
  });
  vi.mocked(verifyFace).mockResolvedValue({ verified: true, similarity: 99 });

  // jsdom nu are `blob:`, nici redare media, nici context 2D.
  URL.createObjectURL = vi.fn(() => 'blob:selfie');
  URL.revokeObjectURL = vi.fn();
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ({ drawImage: vi.fn() }) as unknown as CanvasRenderingContext2D,
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toBlob = function toBlob(cb: BlobCallback) {
    cb(SELFIE);
  };
  // Deschiderea selectorului de fișiere e o acțiune observabilă, nu un efect
  // secundar: pe ea se sprijină trecerea automată pe calea a doua.
  clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);

  setNavigator({ getUserMedia: vi.fn(async () => fakeStream()) });
});

afterEach(() => {
  clickSpy.mockRestore();
});

/* ————————————— nicio cerere înainte de apăsare ————————————— */

describe('nimic pe rețea fără voia utilizatorului', () => {
  it('nu trimite niciun selfie la montare', async () => {
    await renderReady();
    expect(verifyFace).not.toHaveBeenCalled();
  });

  it('nu trimite nimic nici după ce s-a făcut poza — doar la apăsarea trimiterii', async () => {
    await renderReady();
    const video = await openCamera();
    await userEvent.click(screen.getByTestId('verify-shoot'));

    expect(await screen.findByTestId('verify-preview')).toBeInTheDocument();
    expect(verifyFace).not.toHaveBeenCalled();
    expect(video).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('verify-send'));
    await waitFor(() => expect(verifyFace).toHaveBeenCalledTimes(1));
  });
});

/* ————————————————— confidențialitate ————————————————— */

describe('confidențialitate', () => {
  it('spune ce se întâmplă cu selfie-ul ÎNAINTE de orice buton', async () => {
    await renderReady();
    const privacy = screen.getByTestId('verify-privacy');
    expect(privacy).toBeInTheDocument();
    // Textul spune explicit că poza pleacă la server și că nu e păstrată.
    expect(privacy.textContent).toMatch(/server/i);
    expect(privacy.textContent).toMatch(/nu îl păstrează/i);
  });
});

/* ——————————————— calea 1: captura în pagină ——————————————— */

describe('captura în pagină', () => {
  it('arată previzualizarea OGLINDITĂ a camerei frontale', async () => {
    await renderReady();
    const video = await openCamera();
    // Oglindirea stă în CSS, pe clasa asta (`transform: scaleX(-1)`).
    expect(video).toHaveClass('verify-camera__video');
  });

  it('permite refacerea pozei înainte de trimitere', async () => {
    await renderReady();
    await openCamera();
    await userEvent.click(screen.getByTestId('verify-shoot'));
    await screen.findByTestId('verify-preview');

    await userEvent.click(screen.getByTestId('verify-retake'));

    expect(await screen.findByTestId('verify-start')).toBeInTheDocument();
    expect(screen.queryByTestId('verify-preview')).not.toBeInTheDocument();
    expect(verifyFace).not.toHaveBeenCalled();
  });

  it('trimite EXACT blobul nemodificat produs de captură', async () => {
    await renderReady();
    await openCamera();
    await userEvent.click(screen.getByTestId('verify-shoot'));
    await screen.findByTestId('verify-preview');
    await userEvent.click(screen.getByTestId('verify-send'));

    await waitFor(() => expect(verifyFace).toHaveBeenCalledWith(SELFIE, 'selfie.jpg'));
    // Poza trecută prin micșorare e cea din canvas, nu una re-oglindită.
    expect(prepareSelfie).toHaveBeenCalledWith(SELFIE, expect.anything());
  });
});

/* ————————— trecerea automată pe calea a doua ————————— */

describe('trecerea pe calea a doua', () => {
  /** Eroarea cu care browserul respinge `getUserMedia`. */
  function domError(name: string): Error {
    const error = new Error(name);
    error.name = name;
    return error;
  }

  it('permisiune refuzată: explică, NU deschide singur selectorul, dar îl lasă la îndemână', async () => {
    setNavigator({ getUserMedia: vi.fn().mockRejectedValue(domError('NotAllowedError')) });
    await renderReady();

    await userEvent.click(screen.getByTestId('verify-start'));

    const notice = await screen.findByTestId('verify-notice');
    expect(notice.textContent).toMatch(/Accesul la cameră este oprit/);
    expect(screen.queryByTestId('verify-video')).not.toBeInTheDocument();
    // După un „nu" la dialogul de permisiune, un selector care sare singur ar
    // părea o defecțiune. Butonul rămâne pe ecran.
    expect(clickSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('verify-choose')).toBeInTheDocument();
  });

  it('permisiune refuzată: a doua apăsare NU mai cere permisiunea (fără buclă)', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(domError('NotAllowedError'));
    setNavigator({ getUserMedia });
    await renderReady();

    await userEvent.click(screen.getByTestId('verify-start'));
    await screen.findByTestId('verify-notice');
    await userEvent.click(screen.getByTestId('verify-start'));

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    // A doua apăsare duce direct pe calea a doua.
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
  });

  it('permisiune deja refuzată (Permissions API): nici măcar nu cere', async () => {
    const getUserMedia = vi.fn(async () => fakeStream());
    setNavigator({ getUserMedia, permission: 'denied' });
    await renderReady();

    await userEvent.click(screen.getByTestId('verify-start'));

    await screen.findByTestId('verify-notice');
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('fără cameră pe dispozitiv: trece pe calea a doua și deschide selectorul', async () => {
    setNavigator({ getUserMedia: vi.fn().mockRejectedValue(domError('NotFoundError')) });
    await renderReady();

    await userEvent.click(screen.getByTestId('verify-start'));

    const notice = await screen.findByTestId('verify-notice');
    expect(notice.textContent).toMatch(/Camera nu poate fi pornită aici/);
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
  });

  it('`getUserMedia` absent cu totul (WebView vechi): tot calea a doua', async () => {
    setNavigator({ mediaDevices: undefined });
    await renderReady();

    await userEvent.click(screen.getByTestId('verify-start'));

    expect(await screen.findByTestId('verify-notice')).toBeInTheDocument();
    expect(screen.queryByTestId('verify-video')).not.toBeInTheDocument();
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
  });

  it('fluxul pornește dar nu produce cadre: oprește camera și trece pe calea a doua', async () => {
    await renderReady();
    await userEvent.click(screen.getByTestId('verify-start'));
    const video = await screen.findByTestId('verify-video');

    // Nicio metadată, doar eroare: exact camera ocupată de altă aplicație.
    fireEvent(video, new Event('error'));

    expect(await screen.findByTestId('verify-notice')).toBeInTheDocument();
    expect(screen.queryByTestId('verify-video')).not.toBeInTheDocument();
    expect(tracks[0]?.stop).toHaveBeenCalled();
  });

  it('calea a doua duce la aceeași previzualizare, cu `capture="user"`', async () => {
    setNavigator({ mediaDevices: undefined });
    await renderReady();

    const input = screen.getByTestId('verify-file');
    expect(input).toHaveAttribute('accept', 'image/*');
    expect(input).toHaveAttribute('capture', 'user');

    const file = new File(['x'], 'selfie.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByTestId('verify-preview')).toBeInTheDocument();
    expect(prepareSelfie).toHaveBeenCalledWith(file, expect.anything());
    expect(verifyFace).not.toHaveBeenCalled();
  });
});

/* ————————————— oprirea camerei ————————————— */

describe('camera nu rămâne pornită', () => {
  it('se oprește când ecranul se demontează', async () => {
    const { unmount } = await renderReady();
    await openCamera();

    expect(tracks[0]?.stop).not.toHaveBeenCalled();
    unmount();
    expect(tracks[0]?.stop).toHaveBeenCalledTimes(1);
  });

  it('se oprește când aplicația e ascunsă (`pagehide`)', async () => {
    await renderReady();
    await openCamera();

    fireEvent(window, new Event('pagehide'));

    expect(tracks[0]?.stop).toHaveBeenCalled();
  });

  it('se oprește imediat după fotografiere', async () => {
    await renderReady();
    await openCamera();
    await userEvent.click(screen.getByTestId('verify-shoot'));

    await screen.findByTestId('verify-preview');
    expect(tracks[0]?.stop).toHaveBeenCalled();
  });

  it('se oprește la renunțare', async () => {
    await renderReady();
    await openCamera();
    await userEvent.click(screen.getByTestId('verify-cancel'));

    expect(await screen.findByTestId('verify-start')).toBeInTheDocument();
    expect(tracks[0]?.stop).toHaveBeenCalled();
  });
});

/* ————————————— răspunsurile serverului ————————————— */

describe('rezultatul verificării', () => {
  /** Duce fluxul până la trimitere, pe calea a doua (mai scurtă). */
  async function sendViaFile() {
    setNavigator({ mediaDevices: undefined });
    await renderReady();
    fireEvent.change(screen.getByTestId('verify-file'), {
      target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] },
    });
    await screen.findByTestId('verify-preview');
    await userEvent.click(screen.getByTestId('verify-send'));
  }

  it('reușit: badge-ul de cont verificat, fără să mai ceară un selfie', async () => {
    vi.mocked(verifyFace).mockResolvedValue({ verified: true, similarity: 99 });
    await sendViaFile();

    expect(await screen.findByTestId('verify-done')).toHaveTextContent('Cont verificat');
    expect(screen.queryByTestId('verify-send')).not.toBeInTheDocument();
    expect(screen.queryByTestId('verify-start')).not.toBeInTheDocument();
  });

  it('fețele nu se potrivesc: verdict negativ, NU eroare de rețea', async () => {
    vi.mocked(verifyFace).mockResolvedValue({ verified: false, similarity: 12 });
    await sendViaFile();

    const reason = await screen.findByTestId('verify-reason');
    expect(reason.textContent).toMatch(/Nu am putut confirma că ești tu/);
    // Sfaturi concrete, nu doar „a eșuat".
    const tips = screen.getByTestId('verify-tips');
    expect(tips.textContent).toMatch(/lumină/i);
    expect(tips.textContent).toMatch(/nivelul ochilor/i);
    expect(tips.textContent).toMatch(/ochelarii de soare/i);
  });

  it.each([
    ['no_face', /Nu am găsit nicio față/, true],
    ['invalid_image', /nu a putut fi citit/, true],
    ['no_profile', /profil cu poze/, false],
    ['too_large', /prea mare/, false],
    ['rate_limited', /de prea multe ori/, false],
    ['unavailable', /nu răspunde acum/, false],
    ['network', /Conexiune întreruptă/, false],
    ['unknown', /Verificarea nu a reușit/, false],
  ])('%s are text propriu', async (reason, pattern, withTips) => {
    vi.mocked(verifyFace).mockRejectedValue(
      new FaceVerifyError(reason as ConstructorParameters<typeof FaceVerifyError>[0]),
    );
    await sendViaFile();

    const shown = await screen.findByTestId('verify-reason');
    expect(shown.textContent).toMatch(pattern);
    if (withTips) expect(screen.getByTestId('verify-tips')).toBeInTheDocument();
    else expect(screen.queryByTestId('verify-tips')).not.toBeInTheDocument();
  });

  it('imagine prea mare local: nu mai deranjează serverul cu 8 MB', async () => {
    vi.mocked(prepareSelfie).mockResolvedValue({ ok: false, reason: 'too_large' });
    setNavigator({ mediaDevices: undefined });
    await renderReady();

    fireEvent.change(screen.getByTestId('verify-file'), {
      target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] },
    });

    const reason = await screen.findByTestId('verify-reason');
    expect(reason.textContent).toMatch(/prea mare/);
    expect(verifyFace).not.toHaveBeenCalled();
  });

  it('după un eșec se poate reîncerca, din același ecran', async () => {
    vi.mocked(verifyFace).mockRejectedValue(new FaceVerifyError('network'));
    await sendViaFile();
    await screen.findByTestId('verify-reason');

    await userEvent.click(screen.getByTestId('verify-retry'));

    expect(await screen.findByTestId('verify-start')).toBeInTheDocument();
    expect(screen.queryByTestId('verify-reason')).not.toBeInTheDocument();
  });
});

/* ————————————— porțile de la intrare ————————————— */

describe('cine nu intră în flux', () => {
  it('contul deja verificat nu mai e trimis prin selfie', async () => {
    vi.mocked(fetchMyProfile).mockResolvedValue({ ...PROFILE, verified: true });
    render();

    expect(await screen.findByTestId('verify-done')).toBeInTheDocument();
    expect(screen.queryByTestId('verify-start')).not.toBeInTheDocument();
    expect(screen.queryByTestId('verify-file')).not.toBeInTheDocument();
    expect(verifyFace).not.toHaveBeenCalled();
  });

  it('profilul fără poze de referință află înainte să trimită ceva', async () => {
    vi.mocked(fetchMyProfile).mockResolvedValue({ ...PROFILE, photos: [] });
    render();

    const message = await screen.findByTestId('verify-no-photos');
    expect(message.textContent).toMatch(/profil cu poze/);
    expect(screen.queryByTestId('verify-start')).not.toBeInTheDocument();
    expect(verifyFace).not.toHaveBeenCalled();
  });
});
