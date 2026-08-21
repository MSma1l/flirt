import { captureSelfie, SelfieCamera } from '../faceCamera';
import { cameraMessage } from '../messages';
import i18n from '@/i18n';

/** Dimensiunea „fișierului" comprimat — o schimbăm ca să testăm poza prea mare. */
let mockFileSize = 1024 * 1024; // 1 MB, sub limita backend-ului

jest.mock('expo-file-system', () => ({
  File: class {
    size: number;
    constructor() {
      this.size = mockFileSize;
    }
  },
}));

/** Cameră falsă: expunem doar `takePictureAsync`, ca `CameraView` real. */
function fakeCamera(
  impl: SelfieCamera['takePictureAsync'],
): { camera: SelfieCamera; takePictureAsync: jest.Mock } {
  const takePictureAsync = jest.fn(impl);
  return { camera: { takePictureAsync }, takePictureAsync };
}

const picture = { uri: 'file:///cache/selfie.jpg', width: 3024, height: 4032 };

beforeEach(() => {
  mockFileSize = 1024 * 1024;
  jest.clearAllMocks();
});

describe('captureSelfie', () => {
  it('capturează, comprimă și întoarce un selfie gata de upload', async () => {
    const { camera } = fakeCamera(async () => picture);

    const result = await captureSelfie(camera);

    expect(result.status).toBe('captured');
    if (result.status !== 'captured') return;
    // Trece prin `compressPhoto` din features/photos → mereu JPEG, redimensionat.
    expect(result.photo.mimeType).toBe('image/jpeg');
    expect(result.photo.fileName).toMatch(/\.jpg$/);
    expect(result.photo.sizeBytes).toBe(mockFileSize);
  });

  it('capturează la calitate maximă și FĂRĂ EXIF (nu cărăm geolocație)', async () => {
    const { camera, takePictureAsync } = fakeCamera(async () => picture);

    await captureSelfie(camera);

    expect(takePictureAsync).toHaveBeenCalledWith({ quality: 1, exif: false });
  });

  it('respinge când camera nu întoarce nicio poză', async () => {
    const { camera } = fakeCamera(async () => undefined);

    await expect(captureSelfie(camera)).resolves.toEqual({
      status: 'rejected',
      message: cameraMessage('captureFailed'),
    });
  });

  it('respinge (fără să arunce) când camera eșuează', async () => {
    const { camera } = fakeCamera(async () => {
      throw new Error('camera indisponibilă');
    });

    await expect(captureSelfie(camera)).resolves.toEqual({
      status: 'rejected',
      message: cameraMessage('captureFailed'),
    });
  });

  it('respinge selfie-ul care rămâne peste limită chiar și după comprimare', async () => {
    mockFileSize = 50 * 1024 * 1024; // 50 MB — peste `maxUploadBytes` (8 MB)
    const { camera } = fakeCamera(async () => picture);

    const result = await captureSelfie(camera);

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') return;
    // Mesajul vine din validarea comună de poze — nu e o regulă paralelă aici.
    expect(result.message).toMatch(/prea mare/i);
  });
});

/**
 * `messages.ts` e un modul, nu o componentă: îl folosesc și `faceCamera`, și
 * `faceApi`. Citirea trebuie să se facă la FIECARE apel — altfel primul mesaj ar
 * îngheța limba pentru toată sesiunea, iar modulul e încărcat cu mult înainte ca
 * userul să comute limba.
 */
describe('mesajele de verificare urmează limba activă', () => {
  afterEach(async () => {
    await i18n.changeLanguage('ro');
  });

  it('vin din catalog, nu din cod', () => {
    expect(cameraMessage('captureFailed')).toBe('Nu am putut face selfie-ul. Încearcă din nou.');
  });

  it('se traduc la fiecare apel, nu o dată la încărcarea modulului', async () => {
    await i18n.changeLanguage('ru');
    expect(cameraMessage('captureFailed')).toBe('Не удалось сделать селфи. Попробуйте снова.');

    await i18n.changeLanguage('en');
    expect(cameraMessage('permissionBlocked')).toMatch(/^Camera access is turned off\./);
  });
});
