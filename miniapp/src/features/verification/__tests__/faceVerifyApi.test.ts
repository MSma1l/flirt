/**
 * Cererea de verificare și traducerea fiecărui răspuns al serverului.
 *
 * Cazurile NU sunt inventate: sunt exact cele pe care le poate produce
 * `backend/app/api/v1/profiles.py` → `verify_face` + `_validate_image_upload`
 * (413 prea mare, 422 imagine invalidă, 404 fără profil, 5xx serviciu picat,
 * fără răspuns = rețea căzută) plus verdictul negativ, care NU e o eroare.
 *
 * Axios e mock-uit la nivelul clientului: aici verificăm forma cererii și
 * clasificarea răspunsului, nu HTTP-ul.
 */
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', () => ({ api: { post: vi.fn() } }));

const { api } = await import('@/api/client');
const { FaceVerifyError, verifyFace } = await import('../faceVerifyApi');

const CONFIG = { headers: {} } as InternalAxiosRequestConfig;

/** O eroare HTTP cu răspuns, ca cele întoarse de FastAPI. */
function httpError(status: number, detail?: string): AxiosError {
  return new AxiosError('eroare', 'ERR_BAD_REQUEST', CONFIG, null, {
    data: detail ? { detail } : {},
    status,
    statusText: '',
    headers: {},
    config: CONFIG,
  });
}

/** O eroare fără răspuns: cererea nu a ajuns la server. */
function networkError(): AxiosError {
  return new AxiosError('Network Error', 'ERR_NETWORK', CONFIG, {});
}

const SELFIE = new Blob(['octeti'], { type: 'image/jpeg' });

beforeEach(() => {
  vi.mocked(api.post).mockReset();
});

describe('forma cererii', () => {
  it('trimite multipart cu câmpul „file", exact cum îl citește backendul', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { verified: true, similarity: 99 } });

    await verifyFace(SELFIE, 'selfie.jpg');

    const [url, body, options] = vi.mocked(api.post).mock.calls[0] ?? [];
    expect(url).toBe('/profiles/verify-face');
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('file')).toBeInstanceOf(Blob);
    // Fără `Content-Type` scris de noi: browserul îl pune CU granița multipart.
    expect(options).toBeUndefined();
  });
});

describe('verdictul serverului', () => {
  it('reușit: `verified=true`', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { verified: true, similarity: 97.5 } });
    await expect(verifyFace(SELFIE, 'a.jpg')).resolves.toEqual({
      verified: true,
      similarity: 97.5,
    });
  });

  /**
   * Fețele nu se potrivesc. NU e o excepție: backendul răspunde 200 cu
   * `verified=false`, iar ecranul are de arătat altceva decât la o eroare de
   * rețea. Același răspuns vine și când profilul n-are poze de referință
   * (`face_verify.py` → `(False, 0.0)`), motiv pentru care textul `no_match` nu
   * afirmă răspicat de ce a picat.
   */
  it('nepotrivire: 200 cu `verified=false`, fără excepție', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { verified: false, similarity: 0 } });
    await expect(verifyFace(SELFIE, 'a.jpg')).resolves.toEqual({
      verified: false,
      similarity: 0,
    });
  });

  it('tolerează un răspuns incomplet fără să crape', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    await expect(verifyFace(SELFIE, 'a.jpg')).resolves.toEqual({
      verified: false,
      similarity: 0,
    });
  });
});

describe('erorile serverului → motive distincte', () => {
  it.each([
    ['imagine prea mare (413)', httpError(413, 'Fișier prea mare'), 'too_large'],
    ['imagine invalidă (422)', httpError(422, 'Fișier gol.'), 'invalid_image'],
    ['nicio față (422 cu detaliu)', httpError(422, 'Nicio față detectată'), 'no_face'],
    ['profil inexistent (404)', httpError(404, 'Profil inexistent'), 'no_profile'],
    ['prea multe încercări (429)', httpError(429), 'rate_limited'],
    ['serviciu indisponibil (500)', httpError(500), 'unavailable'],
    ['serviciu indisponibil (503)', httpError(503), 'unavailable'],
    ['rețea căzută (fără răspuns)', networkError(), 'network'],
  ])('%s → „%s"', async (_name, error, expected) => {
    vi.mocked(api.post).mockRejectedValue(error);

    await expect(verifyFace(SELFIE, 'a.jpg')).rejects.toMatchObject({
      name: 'FaceVerifyError',
      reason: expected,
    });
  });

  it('orice altceva devine „unknown", nu o excepție nemapată', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('ceva neașteptat'));
    await expect(verifyFace(SELFIE, 'a.jpg')).rejects.toBeInstanceOf(FaceVerifyError);
    await expect(verifyFace(SELFIE, 'a.jpg')).rejects.toMatchObject({ reason: 'unknown' });
  });
});
