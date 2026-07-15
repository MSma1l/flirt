import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert, AlertButton } from 'react-native';

import AnketaWizard from '../index';
import { useAnketaStore } from '@/features/anketa/anketaStore';
import { LocalPhoto, PickPhotoResult } from '@/features/photos/types';
import { ThemeProvider } from '@theme/index';

// Mock router (evită navigarea reală expo-router în teste).
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
}));

// Mock store de auth: doar `setProfileCompleted` e folosit de ecran.
const mockSetProfileCompleted = jest.fn();
jest.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { setProfileCompleted: typeof mockSetProfileCompleted }) => unknown) =>
    selector({ setProfileCompleted: mockSetProfileCompleted }),
}));

// Mock la anketaApi: controlăm referința și spionăm submit-ul.
// `fetchReference` întoarce acum opțiuni {value,label} (label deja localizat).
// Păstrăm value === label aici ca aserțiile de interacțiune să rămână simple;
// maparea reală label_ro e acoperită în `anketaApi.test.ts`.
const mockFetchReference = jest.fn(() =>
  Promise.resolve({
    genders: [
      { value: 'Femeie', label: 'Femeie' },
      { value: 'Bărbat', label: 'Bărbat' },
    ],
    datingStatuses: [
      { value: 'Prietenie', label: 'Prietenie' },
      { value: 'Relație', label: 'Relație' },
    ],
    languages: [
      { value: 'Română', label: 'Română' },
      { value: 'Engleză', label: 'Engleză' },
    ],
    interests: [
      { slug: 'sport', label: 'Sport' },
      { slug: 'muzica', label: 'Muzică' },
    ],
  }),
);
const mockSubmitAnketa = jest.fn((_draft: unknown) => Promise.resolve());
jest.mock('@/features/anketa/anketaApi', () => ({
  fetchReference: () => mockFetchReference(),
  submitAnketa: (draft: unknown) => mockSubmitAnketa(draft),
}));

// Mock la galerie (modul nativ) — controlăm rezultatul selecției de poze.
const mockPickPhoto = jest.fn<Promise<PickPhotoResult>, []>();
const mockOpenAppSettings = jest.fn();
jest.mock('@/features/photos/photoPicker', () => ({
  pickPhoto: () => mockPickPhoto(),
  openAppSettings: () => mockOpenAppSettings(),
  compressPhoto: jest.fn(),
  ensureLibraryPermission: jest.fn(),
  fileSizeBytes: jest.fn(),
}));

// Mock la API-ul de poze — spionăm ordinea și payload-urile.
const mockUploadPhoto = jest.fn<Promise<string[]>, [LocalPhoto]>();
const mockDeletePhoto = jest.fn<Promise<string[]>, [string]>();
const mockReorderPhotos = jest.fn<Promise<string[]>, [string[]]>();
jest.mock('@/features/photos/photosApi', () => ({
  uploadPhoto: (photo: LocalPhoto, options?: { onProgress?: (p: number) => void }) => {
    options?.onProgress?.(1);
    return mockUploadPhoto(photo);
  },
  deletePhoto: (url: string) => mockDeletePhoto(url),
  reorderPhotos: (urls: string[]) => mockReorderPhotos(urls),
}));

/**
 * Backend fals: `POST /profiles/photos` adaugă la coada listei și întoarce lista
 * completă — exact ca `profile_service.add_photo`.
 */
function fakeServerUploads(): string[] {
  const stored: string[] = [];
  mockUploadPhoto.mockImplementation((photo) => {
    stored.push(`https://cdn.flirt.local/photos/p1/${photo.fileName}`);
    return Promise.resolve([...stored]);
  });
  return stored;
}

/** O poză locală, deja comprimată (ce întorc galeria + compresia). */
function localPhoto(n: number): LocalPhoto {
  return {
    uri: `file:///cache/photo-${n}.jpg`,
    mimeType: 'image/jpeg',
    fileName: `photo-${n}.jpg`,
    sizeBytes: 1024 * 1024,
    width: 1920,
    height: 1440,
  };
}

function renderWizard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <AnketaWizard />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

/** Completează valid pasul 0 (Despre tine). */
function fillStep0(
  utils: ReturnType<typeof renderWizard>,
  birthDate = '1998-05-20',
) {
  const { getByPlaceholderText, getByText } = utils;
  fireEvent.changeText(getByPlaceholderText('Numele tău'), 'Ana');
  fireEvent.changeText(getByPlaceholderText('1998-05-20'), birthDate);
  fireEvent.press(getByText('Femeie'));
  fireEvent.changeText(getByPlaceholderText('175'), '175');
}

/** Parcurge pașii 0–3 valid și oprește wizardul pe pasul cu poze. */
async function goToPhotosStep(utils: ReturnType<typeof renderWizard>) {
  const { getByPlaceholderText, getByText } = utils;
  await waitFor(() => getByText('Despre tine'));

  fillStep0(utils);
  fireEvent.press(getByText('Continuă'));

  await waitFor(() => getByText('Localizare'));
  fireEvent.changeText(getByPlaceholderText('Orașul tău'), 'Chișinău');
  fireEvent.press(getByText('Română'));
  fireEvent.press(getByText('Continuă'));

  await waitFor(() => getByText('Prezentare'));
  fireEvent.press(getByText('Continuă'));

  await waitFor(() => getByText('Interese'));
  fireEvent.press(getByText('Sport'));
  fireEvent.press(getByText('Continuă'));

  await waitFor(() => getByText('Pozele tale'));
}

/** Adaugă `n` poze din „galerie" apăsând pe celula de adăugare. */
async function addPhotos(utils: ReturnType<typeof renderWizard>, n: number) {
  for (let i = 1; i <= n; i += 1) {
    mockPickPhoto.mockResolvedValueOnce({ status: 'picked', photo: localPhoto(i) });
    fireEvent.press(utils.getByTestId('photo-add'));
    await waitFor(() => utils.getByTestId(`photo-tile-${i - 1}`));
  }
}

describe('AnketaWizard (onboarding)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fakeServerUploads();
    mockDeletePhoto.mockResolvedValue([]);
    mockReorderPhotos.mockImplementation((urls) => Promise.resolve([...urls]));
    // Store real (Zustand) — resetăm draftul, pozele și pasul între teste.
    useAnketaStore.getState().reset();
  });

  it('încarcă referința și arată primul pas', async () => {
    const { getByText } = renderWizard();
    await waitFor(() => getByText('Despre tine'));
    expect(mockFetchReference).toHaveBeenCalled();
  });

  it('validarea blochează avansarea cu vârstă sub 18 ani (aplicația e 18+ only)', async () => {
    const utils = renderWizard();
    await waitFor(() => utils.getByText('Despre tine'));

    // Data nașterii implică o vârstă sub prag → blocat.
    fillStep0(utils, '2015-01-01');
    fireEvent.press(utils.getByText('Continuă'));

    // Mesajul de eroare apare și rămânem pe primul pas.
    await waitFor(() => utils.getByText('Trebuie să ai cel puțin 18 ani.'));
    expect(utils.getByText('Despre tine')).toBeTruthy();
    expect(utils.queryByText('Localizare')).toBeNull();
  });

  it('sub minimul de poze wizardul NU avansează și explică de ce', async () => {
    const utils = renderWizard();
    await goToPhotosStep(utils);

    // Zero poze — sub `min_photos` = 1.
    fireEvent.press(utils.getByText('Finalizează'));

    await waitFor(() =>
      utils.getByText('Adaugă cel puțin 1 poze ca să continui (mai ai 1 de adăugat).'),
    );
    expect(mockSubmitAnketa).not.toHaveBeenCalled();
    expect(mockUploadPhoto).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('refuzul permisiunii dă mesaj clar + buton „Deschide setările" (fără ecran mort)', async () => {
    const utils = renderWizard();
    await goToPhotosStep(utils);

    mockPickPhoto.mockResolvedValueOnce({ status: 'denied', canAskAgain: false });
    fireEvent.press(utils.getByTestId('photo-add'));

    await waitFor(() => utils.getByTestId('photo-open-settings'));
    expect(utils.getByTestId('photo-error').props.children).toMatch(
      /Nu avem acces la galerie/,
    );

    fireEvent.press(utils.getByTestId('photo-open-settings'));
    expect(mockOpenAppSettings).toHaveBeenCalled();
  });

  it('o poză prea mare e respinsă cu mesaj clar, înainte de orice upload', async () => {
    const utils = renderWizard();
    await goToPhotosStep(utils);

    mockPickPhoto.mockResolvedValueOnce({
      status: 'rejected',
      message:
        'Poza rămâne prea mare (20 MB) chiar și după comprimare, iar limita este 8 MB.',
    });
    fireEvent.press(utils.getByTestId('photo-add'));

    await waitFor(() =>
      utils.getByText(
        'Poza rămâne prea mare (20 MB) chiar și după comprimare, iar limita este 8 MB.',
      ),
    );
    expect(utils.queryByTestId('photo-tile-0')).toBeNull();
    expect(mockUploadPhoto).not.toHaveBeenCalled();
  });

  it('la final salvează anketa și abia apoi urcă pozele, în ordinea din grilă', async () => {
    const utils = renderWizard();
    await goToPhotosStep(utils);
    await addPhotos(utils, 3);

    // Reordonare: a treia poză devine principală.
    fireEvent.press(utils.getByTestId('photo-move-left-2'));
    fireEvent.press(utils.getByTestId('photo-move-left-1'));

    fireEvent.press(utils.getByText('Finalizează'));

    await waitFor(() => {
      expect(mockSubmitAnketa).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Ana',
          birthDate: '1998-05-20',
          gender: 'Femeie',
          heightCm: 175,
          city: 'Chișinău',
          languages: ['Română'],
          interests: ['sport'],
        }),
      );
    });

    await waitFor(() => expect(mockUploadPhoto).toHaveBeenCalledTimes(3));
    // Ordinea uploadului = ordinea din grilă (prima urcată = poza principală).
    const uploaded = mockUploadPhoto.mock.calls.map(([p]) => p.fileName);
    expect(uploaded).toEqual(['photo-3.jpg', 'photo-1.jpg', 'photo-2.jpg']);

    // Anketa se salvează ÎNAINTE de poze (profilul trebuie să existe pe server).
    expect(mockSubmitAnketa.mock.invocationCallOrder[0]).toBeLessThan(
      mockUploadPhoto.mock.invocationCallOrder[0],
    );

    await waitFor(() => {
      expect(mockSetProfileCompleted).toHaveBeenCalledWith(true);
      expect(mockReplace).toHaveBeenCalledWith('/(tabs)/ankete');
    });
  });

  it('la eroare de upload reia de unde a rămas, fără să retrimită anketa', async () => {
    const utils = renderWizard();
    await goToPhotosStep(utils);
    await addPhotos(utils, 3);

    // Primele două poze trec, a treia cade pe rețea o singură dată.
    const stored: string[] = [];
    let failedOnce = false;
    mockUploadPhoto.mockImplementation((photo) => {
      if (photo.fileName === 'photo-3.jpg' && !failedOnce) {
        failedOnce = true;
        return Promise.reject(new Error('Conexiune întreruptă. Verifică internetul.'));
      }
      stored.push(`https://cdn.flirt.local/photos/p1/${photo.fileName}`);
      return Promise.resolve([...stored]);
    });

    fireEvent.press(utils.getByText('Finalizează'));

    await waitFor(() => utils.getByTestId('photo-error'));
    expect(utils.getByTestId('photo-error').props.children).toMatch(
      /Conexiune întreruptă/,
    );
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockUploadPhoto).toHaveBeenCalledTimes(3);

    // Reîncercare: anketa NU se retrimite (un al doilea PUT ar rescrie `photos`
    // cu lista goală și ar șterge pozele deja urcate), iar uploadul reia DOAR
    // poza rămasă — primele două nu se dublează.
    fireEvent.press(utils.getByText('Finalizează'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)/ankete'));
    expect(mockSubmitAnketa).toHaveBeenCalledTimes(1);
    expect(mockUploadPhoto).toHaveBeenCalledTimes(4); // 3 + doar poza eșuată
    expect(stored).toHaveLength(3);
  });

  it('poza scoasă din grilă după ce fusese urcată se șterge și de pe server', async () => {
    const utils = renderWizard();
    await goToPhotosStep(utils);
    await addPhotos(utils, 3);

    // Prima poză urcă, a doua cade → rămâne o poză „orfană" pe server.
    mockUploadPhoto.mockImplementation((photo) =>
      photo.fileName === 'photo-1.jpg'
        ? Promise.resolve(['https://cdn.flirt.local/photos/p1/photo-1.jpg'])
        : Promise.reject(new Error('Conexiune întreruptă.')),
    );
    fireEvent.press(utils.getByText('Finalizează'));
    await waitFor(() => utils.getByTestId('photo-error'));

    // Utilizatorul scoate din grilă exact poza deja urcată.
    jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_title, _message, buttons?: AlertButton[]) => {
        buttons?.find((b) => b.style === 'destructive')?.onPress?.();
      });
    fireEvent.press(utils.getByTestId('photo-remove-0'));

    await waitFor(() =>
      expect(mockDeletePhoto).toHaveBeenCalledWith(
        'https://cdn.flirt.local/photos/p1/photo-1.jpg',
      ),
    );
    jest.restoreAllMocks();
  });
});
