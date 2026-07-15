import { LocalPhoto } from '@/features/photos';

import { FaceVerifyError, verifyFace } from '../faceApi';
import { FACE_MESSAGES, faceVerifyReason } from '../messages';

jest.mock('@/services/api', () => ({
  api: {
    post: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/services/api');

/** Selfie deja capturat și comprimat (exact ce iese din `captureSelfie`). */
const selfie: LocalPhoto = {
  uri: 'file:///cache/photo-1.jpg',
  mimeType: 'image/jpeg',
  fileName: 'photo-1.jpg',
  sizeBytes: 1024 * 1024,
  width: 1080,
  height: 1080,
};

/** Construiește o eroare recunoscută de `axios.isAxiosError`. */
function axiosError(status?: number, detail?: string): Error {
  return Object.assign(new Error('request failed'), {
    isAxiosError: true,
    response:
      status === undefined ? undefined : { status, data: detail ? { detail } : {} },
  });
}

/**
 * `FormData` din Node stringifică partea RN `{uri,name,type}` la „[object Object]"
 * (în React Native, polyfill-ul o păstrează ca obiect). Ca să verificăm ce trimitem
 * cu adevărat, spionăm `append` în loc să citim înapoi din `FormData`.
 */
let appendSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  appendSpy = jest.spyOn(FormData.prototype, 'append');
});

afterEach(() => appendSpy.mockRestore());

describe('verifyFace', () => {
  it('trimite multipart cu câmpul `file` la /profiles/verify-face', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: { verified: true, similarity: 97.3 },
    });

    const result = await verifyFace(selfie);

    const [url, body, cfg] = (api.post as jest.Mock).mock.calls[0];
    expect(url).toBe('/profiles/verify-face');
    expect(body).toBeInstanceOf(FormData);
    expect(cfg.headers).toEqual({ 'Content-Type': 'multipart/form-data' });
    expect(result).toEqual({ verified: true, similarity: 97.3 });
  });

  it('pune în `file` exact uri/name/type ale selfie-ului comprimat', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: { verified: true, similarity: 99 },
    });

    await verifyFace(selfie);

    const [field, value] = appendSpy.mock.calls[0];
    expect(field).toBe('file');
    expect(value).toEqual({
      uri: selfie.uri,
      name: selfie.fileName,
      type: 'image/jpeg',
    });
  });

  it('normalizează răspunsul (verified boolean, similarity numeric)', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: { verified: 0, similarity: null },
    });

    await expect(verifyFace(selfie)).resolves.toEqual({
      verified: false,
      similarity: 0,
    });
  });

  it('aruncă FaceVerifyError cu mesaj tradus la cădere de rețea', async () => {
    (api.post as jest.Mock).mockRejectedValue(axiosError(undefined));

    await expect(verifyFace(selfie)).rejects.toBeInstanceOf(FaceVerifyError);
    await expect(verifyFace(selfie)).rejects.toMatchObject({
      reason: 'network',
      message: FACE_MESSAGES.network,
    });
  });

  it('aruncă „serviciu indisponibil" la 5xx', async () => {
    (api.post as jest.Mock).mockRejectedValue(axiosError(503));

    await expect(verifyFace(selfie)).rejects.toMatchObject({
      reason: 'unavailable',
      message: FACE_MESSAGES.unavailable,
    });
  });
});

describe('faceVerifyReason', () => {
  it('mapează statusurile backend-ului pe motive', () => {
    expect(faceVerifyReason(axiosError(413))).toBe('too_large');
    expect(faceVerifyReason(axiosError(429))).toBe('rate_limited');
    expect(faceVerifyReason(axiosError(404))).toBe('no_profile');
    expect(faceVerifyReason(axiosError(500))).toBe('unavailable');
    expect(faceVerifyReason(axiosError(undefined))).toBe('network');
  });

  it('422 fără mențiunea feței → imagine invalidă (`_validate_image_upload`)', () => {
    expect(
      faceVerifyReason(axiosError(422, 'Conținutul încărcat nu este o imagine validă.')),
    ).toBe('invalid_image');
  });

  it('422 care menționează fața → „nicio față detectată"', () => {
    expect(faceVerifyReason(axiosError(422, 'Nicio față detectată în selfie.'))).toBe(
      'no_face',
    );
  });

  it('o eroare non-axios rămâne necunoscută', () => {
    expect(faceVerifyReason(new Error('boom'))).toBe('unknown');
  });
});
