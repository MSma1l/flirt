import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert, AlertButton } from 'react-native';

import ProfileEditScreen from '../edit';
import { LocalPhoto, PickPhotoResult } from '@/features/photos/types';
import { ThemeProvider } from '@theme/index';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
}));

const PHOTOS = [
  'https://cdn.flirt.local/photos/p1/a.jpg',
  'https://cdn.flirt.local/photos/p1/b.jpg',
  'https://cdn.flirt.local/photos/p1/c.jpg',
];

const mockFetchMyProfile = jest.fn(() =>
  Promise.resolve({
    name: 'Ana',
    birthDate: '1998-05-20',
    gender: 'Femeie',
    heightCm: 175,
    city: 'Chișinău',
    languages: ['Română'],
    datingStatuses: ['Prietenie'],
    interests: ['sport'],
    photos: [...PHOTOS],
  }),
);
jest.mock('@/features/profile/profileApi', () => ({
  fetchMyProfile: () => mockFetchMyProfile(),
}));

const mockSubmitAnketa = jest.fn((_draft: unknown) => Promise.resolve());
jest.mock('@/features/anketa/anketaApi', () => ({
  fetchReference: () =>
    Promise.resolve({
      genders: ['Femeie', 'Bărbat'],
      datingStatuses: ['Prietenie'],
      languages: ['Română'],
      interests: [{ slug: 'sport', label: 'Sport' }],
    }),
  submitAnketa: (draft: unknown) => mockSubmitAnketa(draft),
}));

const mockPickPhoto = jest.fn<Promise<PickPhotoResult>, []>();
jest.mock('@/features/photos/photoPicker', () => ({
  pickPhoto: () => mockPickPhoto(),
  openAppSettings: jest.fn(),
  compressPhoto: jest.fn(),
  ensureLibraryPermission: jest.fn(),
  fileSizeBytes: jest.fn(),
}));

const mockUploadPhoto = jest.fn<Promise<string[]>, [LocalPhoto]>();
const mockDeletePhoto = jest.fn<Promise<string[]>, [string]>();
const mockReorderPhotos = jest.fn<Promise<string[]>, [string[]]>();
jest.mock('@/features/photos/photosApi', () => ({
  uploadPhoto: (photo: LocalPhoto, options?: { onProgress?: (p: number) => void }) => {
    options?.onProgress?.(0.5);
    return mockUploadPhoto(photo);
  },
  deletePhoto: (url: string) => mockDeletePhoto(url),
  reorderPhotos: (urls: string[]) => mockReorderPhotos(urls),
}));

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ProfileEditScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

/** Randează ecranul și așteaptă pozele profilului. */
async function renderLoaded() {
  const utils = renderScreen();
  await waitFor(() => utils.getByTestId('photo-tile-2'));
  return utils;
}

/** Confirmă automat dialogul de ștergere. */
function autoConfirmAlert() {
  jest
    .spyOn(Alert, 'alert')
    .mockImplementation((_title, _message, buttons?: AlertButton[]) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
}

describe('ProfileEditScreen — poze', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUploadPhoto.mockResolvedValue([...PHOTOS]);
    mockDeletePhoto.mockResolvedValue([PHOTOS[1], PHOTOS[2]]);
    mockReorderPhotos.mockImplementation((urls) => Promise.resolve([...urls]));
  });

  afterEach(() => jest.restoreAllMocks());

  it('afișează pozele profilului, prima fiind cea principală', async () => {
    const utils = await renderLoaded();
    expect(utils.getAllByTestId('photo-main-badge')).toHaveLength(1);
    expect(utils.getByLabelText('Poza principală')).toBeTruthy();
  });

  it('reordonarea trimite pe server EXACT noua ordine de URL-uri', async () => {
    const utils = await renderLoaded();

    // A doua poză devine principală.
    fireEvent.press(utils.getByTestId('photo-move-left-1'));

    await waitFor(() =>
      expect(mockReorderPhotos).toHaveBeenCalledWith([PHOTOS[1], PHOTOS[0], PHOTOS[2]]),
    );
  });

  it('ștergerea cere confirmare, apoi apelează backend-ul cu URL-ul corect', async () => {
    autoConfirmAlert();
    const utils = await renderLoaded();

    fireEvent.press(utils.getByTestId('photo-remove-0'));

    expect(Alert.alert).toHaveBeenCalled();
    await waitFor(() => expect(mockDeletePhoto).toHaveBeenCalledWith(PHOTOS[0]));
  });

  it('adăugarea unei poze o urcă imediat (profilul există deja)', async () => {
    const photo: LocalPhoto = {
      uri: 'file:///cache/new.jpg',
      mimeType: 'image/jpeg',
      fileName: 'new.jpg',
      sizeBytes: 1024 * 1024,
      width: 1920,
      height: 1440,
    };
    mockPickPhoto.mockResolvedValueOnce({ status: 'picked', photo });
    const utils = await renderLoaded();

    fireEvent.press(utils.getByTestId('photo-add'));

    await waitFor(() => expect(mockUploadPhoto).toHaveBeenCalledWith(photo));
  });

  it('refuzul permisiunii → mesaj + „Deschide setările", nu un ecran mort', async () => {
    mockPickPhoto.mockResolvedValueOnce({ status: 'denied', canAskAgain: false });
    const utils = await renderLoaded();

    fireEvent.press(utils.getByTestId('photo-add'));

    await waitFor(() => utils.getByTestId('photo-open-settings'));
    expect(utils.getByTestId('photo-error').props.children).toMatch(
      /Nu avem acces la galerie/,
    );
    expect(mockUploadPhoto).not.toHaveBeenCalled();
  });

  it('salvarea trimite pozele în payload — altfel backend-ul le-ar ȘTERGE', async () => {
    const utils = await renderLoaded();

    fireEvent.press(utils.getByText('Salvează'));

    await waitFor(() => expect(mockSubmitAnketa).toHaveBeenCalled());
    expect(mockSubmitAnketa).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Ana', photos: PHOTOS }),
    );
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it('sub minimul de poze salvarea e blocată cu mesaj clar', async () => {
    mockFetchMyProfile.mockResolvedValueOnce({
      name: 'Ana',
      birthDate: '1998-05-20',
      gender: 'Femeie',
      heightCm: 175,
      city: 'Chișinău',
      languages: ['Română'],
      datingStatuses: ['Prietenie'],
      interests: ['sport'],
      photos: [],
    });
    const utils = renderScreen();
    await waitFor(() => utils.getByText('Salvează'));

    fireEvent.press(utils.getByText('Salvează'));

    await waitFor(() =>
      utils.getByText('Adaugă cel puțin 1 poze ca să continui (mai ai 1 de adăugat).'),
    );
    expect(mockSubmitAnketa).not.toHaveBeenCalled();
  });
});

describe('ProfileEditScreen — dată naștere & naționalitate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUploadPhoto.mockResolvedValue([...PHOTOS]);
    mockDeletePhoto.mockResolvedValue([PHOTOS[1], PHOTOS[2]]);
    mockReorderPhotos.mockImplementation((urls) => Promise.resolve([...urls]));
  });
  afterEach(() => jest.restoreAllMocks());

  it('data nașterii prefill-uită se afișează frumos ca dd.mm.yyyy', async () => {
    const utils = await renderLoaded();
    // profilul are birthDate 1998-05-20
    expect(utils.getByText('20.05.1998')).toBeTruthy();
  });

  it('alegerea din calendar setează data și o trimite în ISO la salvare', async () => {
    const utils = await renderLoaded();

    fireEvent.press(utils.getByTestId('birthdate-open'));
    // Mock-ul de datetimepicker întoarce 15.01.2000 la apăsare.
    fireEvent.press(utils.getByTestId('birthdate-picker'));

    await waitFor(() => utils.getByText('15.01.2000'));

    fireEvent.press(utils.getByText('Salvează'));
    await waitFor(() => expect(mockSubmitAnketa).toHaveBeenCalled());
    expect(mockSubmitAnketa).toHaveBeenCalledWith(
      expect.objectContaining({ birthDate: '2000-01-15' }),
    );
  });

  it('selectorul de țară filtrează după căutare și salvează codul ISO2', async () => {
    const utils = await renderLoaded();

    fireEvent.press(utils.getByTestId('nationality-open'));
    fireEvent.changeText(utils.getByTestId('nationality-search'), 'Moldova');

    // După filtrare rămâne doar Moldova (MD); România (RO) dispare.
    await waitFor(() => utils.getByTestId('country-item-MD'));
    expect(utils.queryByTestId('country-item-RO')).toBeNull();

    fireEvent.press(utils.getByTestId('country-item-MD'));

    fireEvent.press(utils.getByText('Salvează'));
    await waitFor(() => expect(mockSubmitAnketa).toHaveBeenCalled());
    expect(mockSubmitAnketa).toHaveBeenCalledWith(
      expect.objectContaining({ nationality: 'MD' }),
    );
  });
});
