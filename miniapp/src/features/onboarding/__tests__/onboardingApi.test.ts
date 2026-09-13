/**
 * Traducerea erorilor de rețea în mesaje pentru ecranele de înregistrare.
 *
 * Regula apărată aici: `detail`-ul serverului ajunge în pagină DOAR pentru
 * erorile de validare, unde e scris pentru utilizator și îi spune ce să repare
 * („Selectează cel puțin un interes valid."). Pentru orice altceva — și mai ales
 * pentru 5xx — arătăm un text propriu. Un `detail` atașat vreodată unei erori
 * interne (urma unei excepții, numele unei coloane, adresa unui serviciu) nu are
 * ce căuta pe ecranul unui om.
 */
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { describe, expect, it } from 'vitest';

import { apiErrorMessage } from '../onboardingApi';
import { formatMb, PHOTO_LIMITS } from '../photoLimits';

const CONFIG = { headers: {} } as InternalAxiosRequestConfig;
const FALLBACK = 'onboarding.errors.saveFailed';

function httpError(status: number, data: unknown = {}) {
  return new AxiosError('eroare', 'ERR_BAD_REQUEST', CONFIG, null, {
    data,
    status,
    statusText: '',
    headers: {},
    config: CONFIG,
  });
}

describe('detaliul serverului ajunge pe ecran doar când e validare', () => {
  it.each([400, 422])('%i: detaliul e util, deci se arată', (status) => {
    const detail = 'Selectează cel puțin un interes valid.';
    expect(apiErrorMessage(httpError(status, { detail }), FALLBACK)).toEqual({ text: detail });
  });

  it('422 de moderare: motivul respingerii pozei rămâne vizibil', () => {
    const detail = 'Poza conține nuditate explicită și nu poate fi publicată.';
    expect(apiErrorMessage(httpError(422, { detail }), FALLBACK)).toEqual({ text: detail });
  });

  it.each([500, 502, 503])('%i: NU arătăm detaliul serverului', (status) => {
    const leak = 'psycopg.errors.UniqueViolation: duplicate key value in users.email';
    expect(apiErrorMessage(httpError(status, { detail: leak }), FALLBACK)).toEqual({
      key: FALLBACK,
    });
  });

  it.each([401, 403, 404, 409, 429])('%i: text propriu, nu cel al serverului', (status) => {
    expect(apiErrorMessage(httpError(status, { detail: 'orice' }), FALLBACK)).toEqual({
      key: FALLBACK,
    });
  });

  it('un `detail` gol pe o eroare de validare cade tot pe textul nostru', () => {
    expect(apiErrorMessage(httpError(422, { detail: '   ' }), FALLBACK)).toEqual({
      key: FALLBACK,
    });
  });

  it('`detail`-ul de listă al FastAPI (422 din schemă) nu se arată ca text', () => {
    const pydantic = { detail: [{ loc: ['body', 'name'], msg: 'field required' }] };
    expect(apiErrorMessage(httpError(422, pydantic), FALLBACK)).toEqual({ key: FALLBACK });
  });
});

describe('celelalte forme de eșec', () => {
  it('413 are mesajul propriu, cu limita reală', () => {
    expect(apiErrorMessage(httpError(413, { detail: 'Request entity too large' }), FALLBACK)).toEqual(
      {
        key: 'onboarding.errors.photoTooLarge',
        params: { limit: formatMb(PHOTO_LIMITS.maxUploadBytes) },
      },
    );
  });

  it('fără răspuns de la server → mesajul de rețea', () => {
    const offline = new AxiosError('Network Error', 'ERR_NETWORK', CONFIG, {});
    expect(apiErrorMessage(offline, FALLBACK)).toEqual({ key: 'onboarding.errors.network' });
  });

  it('o eroare care nu vine de la axios → textul de rezervă', () => {
    expect(apiErrorMessage(new TypeError('boom'), FALLBACK)).toEqual({ key: FALLBACK });
  });
});
