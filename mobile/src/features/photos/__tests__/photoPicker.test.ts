import * as ImagePicker from 'expo-image-picker';

import { compressPhoto, pickPhoto } from '../photoPicker';

/* -------------------------------------------------------------------------- */
/* Mock-uri native controlabile (numele încep cu `mock` — cerință de hoisting). */
/* -------------------------------------------------------------------------- */

// Coada de dimensiuni returnate de `new File(uri).size`, în ordinea apelurilor.
const mockSizeQueue: number[] = [];
let mockDefaultSize = 1024 * 1024; // 1 MB

jest.mock('expo-file-system', () => ({
  File: class MockFile {
    size: number;
    constructor() {
      this.size =
        mockSizeQueue.length > 0 ? Number(mockSizeQueue.shift()) : mockDefaultSize;
    }
  },
}));

const mockManipulateAsync = jest.fn(
  async (uri: string, actions: unknown[], options: { compress: number }) => {
    void actions;
    void options;
    return { uri: `${uri}-compressed`, width: 1920, height: 1440 };
  },
);

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: (uri: string, actions: unknown[], options: { compress: number }) =>
    mockManipulateAsync(uri, actions, options),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
}));

/* --------------------------------- Helpere -------------------------------- */

const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;

/** Un asset tipic de telefon modern: 4032×3024, HEIC, 12 MB. */
const bigAsset = {
  uri: 'file:///dcim/IMG_0001.heic',
  width: 4032,
  height: 3024,
  mimeType: 'image/heic',
  fileName: 'IMG_0001.heic',
  fileSize: 12 * 1024 * 1024,
};

function grantPermission(): void {
  picker.getMediaLibraryPermissionsAsync.mockResolvedValue({
    granted: true,
    canAskAgain: true,
    status: 'granted',
  } as never);
}

function pickAsset(asset: object = bigAsset): void {
  picker.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [asset],
  } as never);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSizeQueue.length = 0;
  mockDefaultSize = 1024 * 1024;
});

describe('permisiunea la galerie', () => {
  it('refuzul NU crapă: întoarce „denied" (cu semnalul că sistemul nu mai întreabă)', async () => {
    picker.getMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: true,
      status: 'undetermined',
    } as never);
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: false,
      status: 'denied',
    } as never);

    const result = await pickPhoto();

    expect(result).toEqual({ status: 'denied', canAskAgain: false });
    expect(picker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('nu redeschide dialogul dacă permisiunea e deja acordată', async () => {
    grantPermission();
    pickAsset();

    await pickPhoto();

    expect(picker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
    expect(picker.launchImageLibraryAsync).toHaveBeenCalled();
  });

  it('galeria închisă fără selecție → „cancelled", fără eroare', async () => {
    grantPermission();
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: true,
      assets: null,
    } as never);

    expect(await pickPhoto()).toEqual({ status: 'cancelled' });
  });
});

describe('compresie înainte de upload', () => {
  it('redimensionează la 1920px pe latura mare și reencodează JPEG', async () => {
    mockSizeQueue.push(3 * 1024 * 1024);

    const result = await compressPhoto(bigAsset);

    expect(mockManipulateAsync).toHaveBeenCalledTimes(1);
    const [uri, actions, options] = mockManipulateAsync.mock.calls[0];
    expect(uri).toBe(bigAsset.uri);
    expect(actions).toEqual([{ resize: { width: 1920 } }]);
    expect(options).toEqual({ compress: 0.8, format: 'jpeg' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.photo.mimeType).toBe('image/jpeg');
      expect(result.photo.sizeBytes).toBe(3 * 1024 * 1024);
      expect(result.photo.uri).toBe('file:///dcim/IMG_0001.heic-compressed');
    }
  });

  it('recomprimă la calitate mai mică dacă poza tot depășește 8 MB', async () => {
    // 9 MB la calitate 0.8 → încă peste limită; 5 MB la 0.6 → intră.
    mockSizeQueue.push(9 * 1024 * 1024, 5 * 1024 * 1024);

    const result = await compressPhoto(bigAsset);

    expect(mockManipulateAsync).toHaveBeenCalledTimes(2);
    expect(mockManipulateAsync.mock.calls[0][2]).toEqual({ compress: 0.8, format: 'jpeg' });
    expect(mockManipulateAsync.mock.calls[1][2]).toEqual({ compress: 0.6, format: 'jpeg' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.photo.sizeBytes).toBe(5 * 1024 * 1024);
  });

  it('respinge cu mesaj clar poza care rămâne prea mare și la calitatea minimă', async () => {
    mockDefaultSize = 20 * 1024 * 1024; // 20 MB, orice am face

    const result = await compressPhoto(bigAsset);

    // 0.8 → 0.6 → 0.4 (calitatea minimă), apoi renunțăm.
    expect(mockManipulateAsync).toHaveBeenCalledTimes(3);
    expect(mockManipulateAsync.mock.calls[2][2]).toEqual({ compress: 0.4, format: 'jpeg' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('20 MB');
      expect(result.message).toContain('8 MB');
    }
  });

  it('nu redimensionează o poză deja mică (doar o recomprimă)', async () => {
    const smallAsset = { ...bigAsset, width: 1200, height: 900, mimeType: 'image/jpeg' };
    mockSizeQueue.push(500 * 1024);

    const result = await compressPhoto(smallAsset);

    expect(mockManipulateAsync.mock.calls[0][1]).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('respinge un tip nepermis ÎNAINTE de orice procesare', async () => {
    const gif = { ...bigAsset, mimeType: 'image/gif' };

    const result = await compressPhoto(gif);

    expect(mockManipulateAsync).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/Tip de fișier nepermis/);
  });
});

describe('pickPhoto', () => {
  it('întoarce poza comprimată, gata de upload', async () => {
    grantPermission();
    pickAsset();
    mockSizeQueue.push(2 * 1024 * 1024);

    const result = await pickPhoto();

    expect(result.status).toBe('picked');
    if (result.status === 'picked') {
      expect(result.photo.mimeType).toBe('image/jpeg');
      expect(result.photo.fileName).toMatch(/\.jpg$/);
    }
  });

  it('propagă respingerea unei poze prea mari ca mesaj, nu ca excepție', async () => {
    grantPermission();
    pickAsset();
    mockDefaultSize = 30 * 1024 * 1024;

    const result = await pickPhoto();

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.message).toContain('prea mare');
  });

  it('o eroare de sistem la deschiderea galeriei nu crapă ecranul', async () => {
    grantPermission();
    picker.launchImageLibraryAsync.mockRejectedValue(new Error('boom'));

    const result = await pickPhoto();

    expect(result).toEqual({
      status: 'rejected',
      message: 'Nu am putut deschide galeria. Încearcă din nou.',
    });
  });
});
