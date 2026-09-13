/**
 * Clasificarea eșecurilor rutei de folosire a invitațiilor.
 *
 * Fiecare caz pe care îl întoarce `backend/app/services/loyalty.py::redeem_invite`
 * trebuie să ajungă la un mesaj DIFERIT. Testul ăsta e plasa care prinde ziua în
 * care trei cazuri distincte încep să arate la fel în interfață.
 */
import { AxiosError, type AxiosResponse } from 'axios';
import { describe, expect, it } from 'vitest';

import {
  classifyLoadError,
  loadErrorKey,
  redeemErrorKey,
  RedeemError,
  toRedeemError,
} from '../loyaltyErrors';

/** Un eșec HTTP ca cel produs de axios, cu `detail`-ul FastAPI. */
function httpError(status: number, detail?: string): AxiosError {
  const response = {
    status,
    statusText: '',
    headers: {},
    config: {} as never,
    data: detail === undefined ? {} : { detail },
  } as AxiosResponse;
  return new AxiosError('request failed', 'ERR_BAD_RESPONSE', undefined, null, response);
}

/** Cererea nu a ajuns nicăieri: axios fără `response`. */
function networkError(): AxiosError {
  return new AxiosError('Network Error', 'ERR_NETWORK');
}

describe('toRedeemError — cazurile backendului', () => {
  it('404 înseamnă cod inexistent', () => {
    expect(toRedeemError(httpError(404, 'Cod de invitație invalid.')).kind).toBe('not_found');
  });

  it('409 „anulată" înseamnă invitație retrasă de organizator', () => {
    expect(toRedeemError(httpError(409, 'Invitația a fost anulată.')).kind).toBe('revoked');
  });

  it('409 „expirat" înseamnă invitație ieșită din termen', () => {
    expect(toRedeemError(httpError(409, 'Invitația a expirat.')).kind).toBe('expired');
  });

  it('409 „numărul maxim" înseamnă invitație epuizată', () => {
    expect(
      toRedeemError(
        httpError(409, 'Invitația a fost deja folosită de numărul maxim de persoane.'),
      ).kind,
    ).toBe('exhausted');
  });

  it('potrivirea nu depinde de diacritice', () => {
    expect(toRedeemError(httpError(409, 'Invitatia a fost anulata.')).kind).toBe('revoked');
  });

  it('un 409 cu alt text rămâne „nu mai poate fi folosită", nu o cauză inventată', () => {
    expect(toRedeemError(httpError(409, 'something else entirely')).kind).toBe('unusable');
  });

  it('403 înseamnă treaptă insuficientă și păstrează pragul cerut', () => {
    const error = toRedeemError(
      httpError(403, 'Invitația cere cel puțin 5 ștampile Flirt Passport.'),
    );
    expect(error.kind).toBe('tier_too_low');
    expect(error.requiredStamps).toBe(5);
  });

  it('403 fără cifră în mesaj nu inventează un prag', () => {
    const error = toRedeemError(httpError(403, 'nu ai destule'));
    expect(error.kind).toBe('tier_too_low');
    expect(error.requiredStamps).toBeNull();
  });

  it('429 e limitatorul de rată al rutei', () => {
    expect(toRedeemError(httpError(429)).kind).toBe('rate_limit');
  });

  it('lipsa răspunsului e „fără rețea", nu „server căzut"', () => {
    expect(toRedeemError(networkError()).kind).toBe('network');
  });

  it('un 500 e o eroare de server', () => {
    expect(toRedeemError(httpError(500)).kind).toBe('server');
  });

  it('un 4xx netratat cade pe necunoscut, nu pe un mesaj greșit', () => {
    expect(toRedeemError(httpError(418)).kind).toBe('unknown');
  });

  it('orice altceva decât axios devine necunoscut', () => {
    expect(toRedeemError(new Error('boom')).kind).toBe('unknown');
  });

  it('un `RedeemError` deja clasificat trece neatins', () => {
    const original = new RedeemError('expired');
    expect(toRedeemError(original)).toBe(original);
  });
});

describe('cheile de traducere', () => {
  it('fiecare cauză are cheia ei în namespace-ul `screens`', () => {
    expect(redeemErrorKey('not_found')).toBe('screens:loyalty.invite.errors.not_found');
    expect(loadErrorKey('network')).toBe('screens:loyalty.errors.network');
  });
});

describe('classifyLoadError', () => {
  it('deosebește rețeaua căzută de serverul care a răspuns prost', () => {
    expect(classifyLoadError(networkError())).toBe('network');
    expect(classifyLoadError(httpError(500))).toBe('server');
    expect(classifyLoadError(new Error('boom'))).toBe('server');
  });
});
