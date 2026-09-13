/**
 * Ecranul de trepte: încărcare, editare, salvare, validările care BLOCHEAZĂ
 * cererea și eroarea serverului.
 *
 * Regula testelor de aici: o validare „care blochează" se dovedește prin absența
 * cererii (`callsTo(...)` gol), nu prin prezența unui mesaj — un mesaj afișat
 * lângă o cerere plecată n-ar fi apărat nimic.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { LoyaltyPage } from './LoyaltyPage';
import type { LoyaltyTiers } from '../api/types';
import { mockFetch, renderWithProviders, seedAdminSession } from '../test/harness';

const TIERS: LoyaltyTiers = {
  tiers: [
    { code: 'bronze', name: 'Bronze', min_stamps: 3, discount_percent: 5 },
    { code: 'silver', name: 'Silver', min_stamps: 6, discount_percent: 10 },
  ],
  max_total_discount_percent: 30,
  updated_at: new Date('2026-01-15T10:00:00Z').toISOString(),
};

const PUT = 'PUT /admin/loyalty/tiers';
const GET = 'GET /admin/loyalty/tiers';

/** Randează ecranul și așteaptă scara încărcată. */
async function renderTiers(routes: Parameters<typeof mockFetch>[0] = {}) {
  seedAdminSession();
  const api = mockFetch({ [GET]: { body: TIERS }, ...routes });
  const person = userEvent.setup();
  renderWithProviders(<LoyaltyPage />);
  await screen.findByDisplayValue('Bronze');
  return { api, person };
}

/** Rescrie un câmp numeric (input de tip number nu acceptă `type` peste valoare). */
async function retype(
  person: ReturnType<typeof userEvent.setup>,
  field: HTMLElement,
  value: string,
): Promise<void> {
  await person.clear(field);
  await person.type(field, value);
}

describe('LoyaltyPage — încărcare', () => {
  it('arată treptele configurate și plafonul', async () => {
    await renderTiers();

    expect(screen.getByLabelText('Cod treapta 1')).toHaveValue('bronze');
    expect(screen.getByLabelText('Prag ștampile treapta 1')).toHaveValue(3);
    expect(screen.getByLabelText('Reducere treapta 2')).toHaveValue(10);
    expect(screen.getByLabelText('Plafon total de reducere (%)')).toHaveValue(30);
  });

  it('arată eroarea serverului la încărcare, cu buton de reîncercare', async () => {
    seedAdminSession();
    mockFetch({ [GET]: { status: 500, body: { detail: 'Baza de date nu răspunde' } } });
    renderWithProviders(<LoyaltyPage />);

    expect(await screen.findByText('Baza de date nu răspunde')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reîncearcă' })).toBeInTheDocument();
  });
});

describe('LoyaltyPage — salvare', () => {
  it('trimite TOATĂ scara, ca numere, cu plafonul', async () => {
    const { api, person } = await renderTiers({ [PUT]: { body: TIERS } });

    await retype(person, screen.getByLabelText('Prag ștampile treapta 2'), '8');
    await retype(person, screen.getByLabelText('Plafon total de reducere (%)'), '25');
    await person.click(screen.getByRole('button', { name: 'Salvează treptele' }));

    await waitFor(() => expect(api.callsTo(PUT)).toHaveLength(1));
    expect(api.callsTo(PUT)[0]?.body).toEqual({
      tiers: [
        { code: 'bronze', name: 'Bronze', min_stamps: 3, discount_percent: 5 },
        { code: 'silver', name: 'Silver', min_stamps: 8, discount_percent: 10 },
      ],
      max_total_discount_percent: 25,
    });
    expect(await screen.findByTestId('tiers-saved')).toBeInTheDocument();
  });

  it('adaugă o treaptă nouă și o trimite', async () => {
    const { api, person } = await renderTiers({ [PUT]: { body: TIERS } });

    await person.click(screen.getByRole('button', { name: 'Adaugă treaptă' }));
    await person.type(screen.getByLabelText('Cod treapta 3'), 'gold');
    await person.type(screen.getByLabelText('Nume treapta 3'), 'Gold');
    await person.type(screen.getByLabelText('Prag ștampile treapta 3'), '12');
    await person.type(screen.getByLabelText('Reducere treapta 3'), '15');
    await person.click(screen.getByRole('button', { name: 'Salvează treptele' }));

    await waitFor(() => expect(api.callsTo(PUT)).toHaveLength(1));
    expect(api.callsTo(PUT)[0]?.body).toMatchObject({
      tiers: [
        { code: 'bronze' },
        { code: 'silver' },
        { code: 'gold', name: 'Gold', min_stamps: 12, discount_percent: 15 },
      ],
    });
  });

  it('șterge o treaptă și trimite scara rămasă', async () => {
    const { api, person } = await renderTiers({ [PUT]: { body: TIERS } });

    await person.click(screen.getByRole('button', { name: 'Șterge treapta 2' }));
    await person.click(screen.getByRole('button', { name: 'Salvează treptele' }));

    await waitFor(() => expect(api.callsTo(PUT)).toHaveLength(1));
    expect(api.callsTo(PUT)[0]?.body).toMatchObject({ tiers: [{ code: 'bronze' }] });
  });

  it('arată mesajul serverului când salvarea eșuează', async () => {
    const { api, person } = await renderTiers({
      [PUT]: { status: 422, body: { detail: 'Scara nu poate fi salvată acum.' } },
    });

    await retype(person, screen.getByLabelText('Reducere treapta 1'), '7');
    await person.click(screen.getByRole('button', { name: 'Salvează treptele' }));

    await waitFor(() => expect(api.callsTo(PUT)).toHaveLength(1));
    expect(await screen.findByText('Scara nu poate fi salvată acum.')).toBeInTheDocument();
    expect(screen.queryByTestId('tiers-saved')).not.toBeInTheDocument();
  });
});

describe('LoyaltyPage — validări care BLOCHEAZĂ cererea', () => {
  it('respinge un prag mai mic decât cel precedent', async () => {
    const { api, person } = await renderTiers({ [PUT]: { body: TIERS } });

    await retype(person, screen.getByLabelText('Prag ștampile treapta 2'), '2');

    expect(await screen.findByText(/mai mare decât al treptei precedente/)).toBeInTheDocument();
    await person.click(screen.getByRole('button', { name: 'Salvează treptele' }));
    expect(api.callsTo(PUT)).toHaveLength(0);
  });

  it('respinge două praguri egale', async () => {
    const { api, person } = await renderTiers({ [PUT]: { body: TIERS } });

    await retype(person, screen.getByLabelText('Prag ștampile treapta 2'), '3');

    expect(await screen.findByText(/același prag/)).toBeInTheDocument();
    await person.click(screen.getByRole('button', { name: 'Salvează treptele' }));
    expect(api.callsTo(PUT)).toHaveLength(0);
  });

  it('respinge codurile duplicate', async () => {
    const { api, person } = await renderTiers({ [PUT]: { body: TIERS } });

    await retype(person, screen.getByLabelText('Cod treapta 2'), 'bronze');

    expect(await screen.findByText(/se repetă/)).toBeInTheDocument();
    await person.click(screen.getByRole('button', { name: 'Salvează treptele' }));
    expect(api.callsTo(PUT)).toHaveLength(0);
  });

  it('respinge un procent peste 100', async () => {
    const { api, person } = await renderTiers({ [PUT]: { body: TIERS } });

    await retype(person, screen.getByLabelText('Reducere treapta 1'), '150');

    expect(await screen.findByText(/între 0 și 100/)).toBeInTheDocument();
    await person.click(screen.getByRole('button', { name: 'Salvează treptele' }));
    expect(api.callsTo(PUT)).toHaveLength(0);
  });

  it('respinge un plafon incoerent', async () => {
    const { api, person } = await renderTiers({ [PUT]: { body: TIERS } });

    await retype(person, screen.getByLabelText('Plafon total de reducere (%)'), '120');

    expect(await screen.findByText(/Plafonul trebuie să fie între 0 și 100%/)).toBeInTheDocument();
    await person.click(screen.getByRole('button', { name: 'Salvează treptele' }));
    expect(api.callsTo(PUT)).toHaveLength(0);
  });

  it('respinge o treaptă fără nume', async () => {
    const { api, person } = await renderTiers({ [PUT]: { body: TIERS } });

    await person.clear(screen.getByLabelText('Nume treapta 1'));

    expect(await screen.findByText(/Numele treptei este obligatoriu/)).toBeInTheDocument();
    await person.click(screen.getByRole('button', { name: 'Salvează treptele' }));
    expect(api.callsTo(PUT)).toHaveLength(0);
  });
});

describe('LoyaltyPage — consecința unei schimbări', () => {
  it('spune ce interval de ștampile pierde treapta când pragul urcă', async () => {
    const { person } = await renderTiers();

    await retype(person, screen.getByLabelText('Prag ștampile treapta 1'), '5');

    const changes = await screen.findByTestId('tiers-changes');
    expect(changes.textContent).toMatch(/PIERD treapta/);
    expect(changes.textContent).toContain('3–4');
    // Onestitate: cifra exactă nu există pe backend, iar ecranul o spune.
    expect(changes.textContent).toMatch(/nu expune distribuția ștampilelor/);
  });

  it('avertizează când o treaptă depășește plafonul, fără să blocheze salvarea', async () => {
    const { api, person } = await renderTiers({ [PUT]: { body: TIERS } });

    await retype(person, screen.getByLabelText('Reducere treapta 2'), '40');

    const warnings = await screen.findByTestId('tiers-warnings');
    expect(warnings.textContent).toMatch(/peste plafonul de 30%/);

    await person.click(screen.getByRole('button', { name: 'Salvează treptele' }));
    await waitFor(() => expect(api.callsTo(PUT)).toHaveLength(1));
  });

  it('„Renunță la modificări" readuce valorile serverului', async () => {
    const { person } = await renderTiers();

    await retype(person, screen.getByLabelText('Prag ștampile treapta 1'), '9');
    await person.click(screen.getByRole('button', { name: 'Renunță la modificări' }));

    expect(screen.getByLabelText('Prag ștampile treapta 1')).toHaveValue(3);
    expect(screen.queryByTestId('tiers-changes')).not.toBeInTheDocument();
  });
});
