import {
  deletePhoto,
  isRetriableError,
  PhotoUploadError,
  reorderPhotos,
  uploadErrorMessage,
  uploadPhoto,
} from '../photosApi';
import { LocalPhoto } from '../types';

jest.mock('@/services/api', () => ({
  api: {
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/services/api');

/** O poză deja comprimată, validă (2 MB, JPEG). */
const photo: LocalPhoto = {
  uri: 'file:///cache/photo-1.jpg',
  mimeType: 'image/jpeg',
  fileName: 'photo-1.jpg',
  sizeBytes: 2 * 1024 * 1024,
  width: 1920,
  height: 1440,
};

/** Construiește o eroare recunoscută de `axios.isAxiosError`. */
function axiosError(status?: number, detail?: string): Error {
  return Object.assign(new Error('request failed'), {
    isAxiosError: true,
    response:
      status === undefined ? undefined : { status, data: detail ? { detail } : {} },
  });
}

beforeEach(() => jest.clearAllMocks());

describe('uploadPhoto', () => {
  it('trimite multipart cu câmpul `file` și raportează progresul', async () => {
    (api.post as jest.Mock).mockImplementation(
      async (
        _url: string,
        _body: FormData,
        cfg: { onUploadProgress?: (e: { loaded: number; total?: number }) => void },
      ) => {
        cfg.onUploadProgress?.({ loaded: 25, total: 100 });
        cfg.onUploadProgress?.({ loaded: 100, total: 100 });
        return { data: ['https://cdn.flirt.local/photos/p1/a.jpg'] };
      },
    );

    const progress: number[] = [];
    const urls = await uploadPhoto(photo, { onProgress: (p) => progress.push(p) });

    const [url, body, cfg] = (api.post as jest.Mock).mock.calls[0];
    expect(url).toBe('/profiles/photos');
    expect(body).toBeInstanceOf(FormData);
    expect(cfg.headers).toEqual({ 'Content-Type': 'multipart/form-data' });
    expect(progress).toEqual([0.25, 1]);
    expect(urls).toEqual(['https://cdn.flirt.local/photos/p1/a.jpg']);
  });

  it('respinge LOCAL o poză peste limită — fără să atingă rețeaua', async () => {
    const huge: LocalPhoto = { ...photo, sizeBytes: 12 * 1024 * 1024 };

    await expect(uploadPhoto(huge)).rejects.toThrow(/peste limita de 8 MB/);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('respinge LOCAL un tip nepermis — fără să atingă rețeaua', async () => {
    const gif: LocalPhoto = { ...photo, mimeType: 'image/gif' };

    await expect(uploadPhoto(gif)).rejects.toThrow(/Tip de fișier nepermis/);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('reîncearcă la eroare de rețea și reușește', async () => {
    (api.post as jest.Mock)
      .mockRejectedValueOnce(axiosError())
      .mockResolvedValueOnce({ data: ['u1'] });

    const urls = await uploadPhoto(photo, { retryDelayMs: 0 });

    expect(api.post).toHaveBeenCalledTimes(2);
    expect(urls).toEqual(['u1']);
  });

  it('după epuizarea reîncercărilor aruncă un mesaj de rețea clar', async () => {
    (api.post as jest.Mock).mockRejectedValue(axiosError());

    await expect(uploadPhoto(photo, { retries: 2, retryDelayMs: 0 })).rejects.toThrow(
      /Conexiune întreruptă/,
    );
    expect(api.post).toHaveBeenCalledTimes(3); // 1 încercare + 2 reîncercări
  });

  it('NU reîncearcă la 422 (poza e problema) și arată mesajul backend-ului', async () => {
    (api.post as jest.Mock).mockRejectedValue(
      axiosError(422, 'Conținutul încărcat nu este o imagine validă.'),
    );

    await expect(uploadPhoto(photo, { retryDelayMs: 0 })).rejects.toThrow(
      'Conținutul încărcat nu este o imagine validă.',
    );
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('traduce 413 în mesajul de limită depășită', async () => {
    (api.post as jest.Mock).mockRejectedValue(axiosError(413));

    await expect(uploadPhoto(photo, { retryDelayMs: 0 })).rejects.toThrow(
      /depășește limita de 8 MB/,
    );
  });
});

/**
 * Bug real: pe WEB uploadul pica cu „Lipsește câmpul 'file'". Cauza — browserul NU
 * acceptă obiectul {uri,name,type} ca fișier (îl serializează `[object Object]`), iar
 * header-ul `Content-Type: multipart/form-data` forțat manual rupe boundary-ul.
 * Aici blindăm ambele platforme: web = Blob real + fără header manual; nativ = neschimbat.
 */
describe('postPhoto — web vs nativ', () => {
  /** Platforma reală, capturată de `jest.setup.js` înainte de orice mutare. */
  function originalOS(): string {
    return (global as unknown as { __ORIGINAL_PLATFORM_OS: string }).__ORIGINAL_PLATFORM_OS;
  }

  it('pe WEB atașează un Blob REAL cu nume și NU forțează Content-Type', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const RN = require('react-native');
    const originalOS = RN.Platform.OS;
    RN.Platform.OS = 'web';

    const blob = new Blob(['bytes-poza'], { type: 'image/jpeg' });
    const fetchMock = jest.fn(async () => ({ blob: async () => blob }));
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
    const appendSpy = jest.spyOn(FormData.prototype, 'append');
    (api.post as jest.Mock).mockResolvedValue({ data: ['u-web'] });

    try {
      const urls = await uploadPhoto(photo);

      // Conținutul e adus din URL-ul `blob:`/`data:` local...
      expect(fetchMock).toHaveBeenCalledWith(photo.uri);
      const fileCall = appendSpy.mock.calls.find((c) => c[0] === 'file');
      // ...și atașat ca Blob real (NU obiectul {uri,name,type}), cu numele fișierului.
      expect(fileCall?.[1]).toBeInstanceOf(Blob);
      expect(fileCall?.[2]).toBe(photo.fileName);
      // Pe web NU trimitem `Content-Type` manual: browserul pune boundary-ul corect.
      const [, , cfg] = (api.post as jest.Mock).mock.calls[0];
      expect(cfg.headers).toBeUndefined();
      expect(urls).toEqual(['u-web']);
    } finally {
      appendSpy.mockRestore();
      RN.Platform.OS = originalOS;
      delete (global as unknown as { fetch?: unknown }).fetch;
    }
  });

  /**
   * `fetch` pe un `blob:` revocat aruncă un `TypeError` sec — NU o eroare axios.
   * Cădea pe ramura `error instanceof Error` și userul citea, în engleză, exact
   * „Failed to fetch".
   */
  it('pe WEB un blob mort dă un mesaj ÎN ROMÂNĂ, nu „Failed to fetch"', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const RN = require('react-native');
    RN.Platform.OS = 'web';
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    try {
      await expect(uploadPhoto(photo, { retryDelayMs: 0 })).rejects.toThrow(
        /Poza nu mai este disponibilă în browser/,
      );
      // Nu are rost reîncercat: un URL revocat nu învie, iar rețeaua e nevinovată.
      expect(api.post).not.toHaveBeenCalled();
    } finally {
      RN.Platform.OS = originalOS();
      delete (global as unknown as { fetch?: unknown }).fetch;
    }
  });

  /**
   * Backend-ul respinge cu 422 „Tip de fișier nepermis" după tipul DECLARAT al
   * părții multipart (`blob.type`). Un blob fără tip ar pleca octet-stream.
   */
  it('pe WEB impune tipul MIME al pozei dacă blob-ul vine fără tip', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const RN = require('react-native');
    RN.Platform.OS = 'web';

    const untyped = new Blob(['bytes-poza']); // type === ''
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({
      blob: async () => untyped,
    }));
    const appendSpy = jest.spyOn(FormData.prototype, 'append');
    (api.post as jest.Mock).mockResolvedValue({ data: ['u-web'] });

    try {
      await uploadPhoto(photo);

      const fileCall = appendSpy.mock.calls.find((c) => c[0] === 'file');
      expect((fileCall?.[1] as Blob).type).toBe('image/jpeg');
    } finally {
      appendSpy.mockRestore();
      RN.Platform.OS = originalOS();
      delete (global as unknown as { fetch?: unknown }).fetch;
    }
  });

  it('pe NATIV păstrează obiectul {uri,name,type} + header multipart (fără regresie)', async () => {
    const appendSpy = jest.spyOn(FormData.prototype, 'append');
    (api.post as jest.Mock).mockResolvedValue({ data: ['u-nat'] });

    try {
      await uploadPhoto(photo);

      const fileCall = appendSpy.mock.calls.find((c) => c[0] === 'file');
      expect(fileCall?.[1]).toEqual({
        uri: photo.uri,
        name: photo.fileName,
        type: photo.mimeType,
      });
      expect(fileCall?.[2]).toBeUndefined(); // fără al 3-lea argument pe nativ
      const [, , cfg] = (api.post as jest.Mock).mock.calls[0];
      expect(cfg.headers).toEqual({ 'Content-Type': 'multipart/form-data' });
    } finally {
      appendSpy.mockRestore();
    }
  });
});

describe('uploadErrorMessage', () => {
  it('NU scapă spre user mesaje tehnice, în engleză, ale platformei', () => {
    // Exact excepțiile pe care le aruncă platformele când cade rețeaua.
    expect(uploadErrorMessage(new TypeError('Failed to fetch'))).toBe(
      'Nu am putut încărca poza. Încearcă din nou.',
    );
    expect(uploadErrorMessage(new Error('Network request failed'))).toBe(
      'Nu am putut încărca poza. Încearcă din nou.',
    );
  });

  it('păstrează mesajele NOASTRE, deja scrise în română', () => {
    const mine = new PhotoUploadError('Poza nu mai este disponibilă în browser.');

    expect(uploadErrorMessage(mine)).toBe('Poza nu mai este disponibilă în browser.');
  });
});

describe('isRetriableError', () => {
  it('reîncearcă doar rețeaua căzută, 5xx și 429', () => {
    expect(isRetriableError(axiosError())).toBe(true);
    expect(isRetriableError(axiosError(500))).toBe(true);
    expect(isRetriableError(axiosError(429))).toBe(true);
    expect(isRetriableError(axiosError(422))).toBe(false);
    expect(isRetriableError(axiosError(413))).toBe(false);
    expect(isRetriableError(new Error('altceva'))).toBe(false);
  });
});

describe('deletePhoto', () => {
  it('trimite URL-ul în body-ul cererii DELETE', async () => {
    (api.delete as jest.Mock).mockResolvedValue({ data: ['u2'] });

    const urls = await deletePhoto('u1');

    expect(api.delete).toHaveBeenCalledWith('/profiles/photos', { data: { url: 'u1' } });
    expect(urls).toEqual(['u2']);
  });
});

describe('reorderPhotos', () => {
  it('trimite exact noua ordine a URL-urilor (prima = poza principală)', async () => {
    (api.put as jest.Mock).mockResolvedValue({ data: ['u3', 'u1', 'u2'] });

    const urls = await reorderPhotos(['u3', 'u1', 'u2']);

    expect(api.put).toHaveBeenCalledWith('/profiles/photos/order', {
      urls: ['u3', 'u1', 'u2'],
    });
    expect(urls).toEqual(['u3', 'u1', 'u2']);
  });
});
