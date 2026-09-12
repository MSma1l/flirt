/**
 * O eroare la încărcarea profilului NU are voie să arate ca un cont nou.
 *
 * DEFECTUL, CU SCENARIU CONCRET
 * -----------------------------
 * Un utilizator cu anketă salvată și două poze urcate redeschide formularul.
 * `GET /profiles/me` răspunde 500 (sau conexiunea cade). `fetchMyProfile`
 * transformă în `null` DOAR un 404 — restul se propagă ca eroare — dar ecranul
 * nu se uita niciodată la `existing.isError`: se uita doar la `isLoading`. Deci
 * `isLoading` devenea `false`, `data` rămânea `undefined`, iar efectul de
 * precompletare trata asta exact ca pe „cont nou": formular GOL, fără niciun
 * mesaj de eroare.
 *
 * Urmarea nu era doar cosmetică. Utilizatorul își retasta datele și apăsa
 * „Salvează", iar `submit` trimite `photos: existing.data?.photos ?? []` —
 * adică o listă GOALĂ. `PUT /profiles/me` REESCRIE lista de poze (vezi
 * comentariul din `onboardingApi.profileToDraft`), deci ambele poze urcate
 * dispăreau și `profile_completed` redevenea fals. Pierdere de date pornită de
 * la o eroare tratată ca succes.
 */
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/api/client';
import { installTelegramStub } from '@/test/telegramStub';

import { ProfileFormScreen } from '../ProfileFormScreen';

import { httpError, networkError, REFERENCE_RESPONSE, renderRouted } from './testUtils';

/** Anketa salvată a utilizatorului, cu pozele pe care nu avem voie să le pierdem. */
const SAVED_PROFILE = {
  name: 'Ana Popescu',
  birth_date: '1996-05-20',
  gender: 'female',
  height_cm: 168,
  city: 'Chișinău',
  languages: ['ro'],
  interests: ['sport'],
  photos: ['https://cdn.test/p1.jpg', 'https://cdn.test/p2.jpg'],
};

/** `GET /profiles/me` eșuează cu eroarea dată; catalogul se încarcă normal. */
function installApi(profileFailure: unknown | null) {
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/profiles/reference') return { data: REFERENCE_RESPONSE } as never;
    if (url === '/profiles/me') {
      if (profileFailure) throw profileFailure;
      return { data: SAVED_PROFILE } as never;
    }
    throw httpError(404);
  });
  return vi.spyOn(api, 'put').mockResolvedValue({ data: SAVED_PROFILE } as never);
}

beforeEach(() => {
  installTelegramStub();
});

describe('încărcarea profilului eșuează', () => {
  it.each([
    ['500 de la server', httpError(500, 'Internal Server Error')],
    ['cererea nu ajunge la server', networkError()],
  ])('%s → ecran de eroare cu reîncercare, NU formular gol', async (_label, failure) => {
    const put = installApi(failure);
    renderRouted(<ProfileFormScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('status-form-error')).toBeInTheDocument();
    });

    // Formularul NU are voie să apară: câmpurile goale ar fi o minciună despre
    // starea contului, iar salvarea lor ar șterge pozele deja urcate.
    expect(screen.queryByLabelText(/Data nașterii/)).not.toBeInTheDocument();
    expect(screen.getByTestId('form-retry')).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
  });

  it('un 404 rămâne „cont nou": formularul se deschide normal', async () => {
    // Perechea testului de mai sus. Fără ea, cineva ar putea „repara" tratând
    // ORICE eșec ca eroare, iar un cont nou (pentru care 404 e răspunsul
    // normal) n-ar mai putea ajunge la formular deloc.
    installApi(httpError(404, 'Anketa nu există încă.'));
    renderRouted(<ProfileFormScreen />);

    expect(await screen.findByLabelText(/Data nașterii/)).toBeInTheDocument();
    expect(screen.queryByTestId('status-form-error')).not.toBeInTheDocument();
  });

  it('când încărcarea reușește, formularul pornește de la datele salvate', async () => {
    installApi(null);
    renderRouted(<ProfileFormScreen />);

    const name = (await screen.findByLabelText(/Nume/)) as HTMLInputElement;
    // Numele de pe server bate precompletarea din Telegram („Ana" din stub).
    expect(name.value).toBe('Ana Popescu');
  });
});
