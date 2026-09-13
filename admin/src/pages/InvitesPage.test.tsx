/**
 * Ecranul de invitații: emitere completă, copierea codului, revocare cu
 * confirmare, filtrare (eveniment pe server, stare pe client) și erori de server.
 *
 * Datele sunt RELATIVE la `Date.now()`: o invitație „activă" scrisă cu o dată
 * fixă devine „expirată" peste câteva luni și testul ar începe să pice degeaba.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { InvitesPage } from './InvitesPage';
import type { AdminEvent, LoyaltyInvite, LoyaltyTiers } from '../api/types';
import { mockFetch, renderWithProviders, seedAdminSession, type Routes } from '../test/harness';

const DAY = 24 * 60 * 60 * 1000;
const isoInDays = (days: number): string => new Date(Date.now() + days * DAY).toISOString();

function datetimeLocalInDays(days: number): string {
  const date = new Date(Date.now() + days * DAY);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

const LIST = 'GET /admin/loyalty/invites';
const CREATE = 'POST /admin/loyalty/invites';
const REVOKE = 'POST /admin/loyalty/invites/i-1/revoke';

function makeEvent(overrides: Partial<AdminEvent> = {}): AdminEvent {
  return {
    id: 'e-1',
    title: 'Flirt Party Chișinău',
    description: null,
    starts_at: isoInDays(10),
    city: 'Chișinău',
    venue: null,
    lat: null,
    lng: null,
    kind: 'flirt_party',
    cover_url: null,
    attendee_count: 0,
    promo_discount_percent: null,
    promo_code: null,
    promo_description: null,
    ticket_price: 150,
    ticket_currency: 'lei',
    ticket_order_count: 0,
    ticket_approved_count: 0,
    ...overrides,
  };
}

const EVENTS = [makeEvent(), makeEvent({ id: 'e-2', title: 'Concert de vară' })];

const TIERS: LoyaltyTiers = {
  tiers: [
    { code: 'bronze', name: 'Bronze', min_stamps: 3, discount_percent: 5 },
    { code: 'silver', name: 'Silver', min_stamps: 6, discount_percent: 10 },
  ],
  max_total_discount_percent: 30,
  updated_at: isoInDays(-1),
};

function makeInvite(overrides: Partial<LoyaltyInvite> = {}): LoyaltyInvite {
  return {
    id: 'i-1',
    event_id: 'e-1',
    event_title: 'Flirt Party Chișinău',
    code: 'ABCD2345EFGH',
    max_uses: 5,
    used_count: 2,
    uses_left: 3,
    expires_at: isoInDays(7),
    min_tier: null,
    min_stamps_required: null,
    discount_percent: null,
    note: null,
    revoked_at: null,
    created_at: isoInDays(-2),
    status: 'active',
    ...overrides,
  };
}

const INVITE = makeInvite();

function baseRoutes(invites: LoyaltyInvite[] = [INVITE]): Routes {
  return {
    'GET /admin/events': { body: EVENTS },
    'GET /admin/loyalty/tiers': { body: TIERS },
    [LIST]: { body: invites },
  };
}

async function renderInvites(routes: Routes = {}, route = '/invites') {
  seedAdminSession();
  const api = mockFetch({ ...baseRoutes(), ...routes });
  const person = userEvent.setup();
  renderWithProviders(<InvitesPage />, { route });
  return { api, person };
}

/** Deschide formularul de emitere și întoarce dialogul. */
async function openForm(person: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await person.click(screen.getByRole('button', { name: 'Invitație nouă' }));
  return screen.findByRole('dialog');
}

describe('InvitesPage — listă', () => {
  it('arată codul, folosirile consumate, expirarea și starea', async () => {
    await renderInvites();

    expect(await screen.findByText('ABCD2345EFGH')).toBeInTheDocument();
    expect(screen.getByText('2/5')).toBeInTheDocument();
    expect(screen.getByText('Activă')).toBeInTheDocument();
  });

  it('arată starea calculată de backend pentru fiecare invitație', async () => {
    seedAdminSession();
    mockFetch({
      ...baseRoutes([
        INVITE,
        makeInvite({ id: 'i-2', code: 'BBBB2345CCCC', status: 'expired' }),
        makeInvite({
          id: 'i-3',
          code: 'CCCC2345DDDD',
          status: 'revoked',
          revoked_at: isoInDays(-1),
        }),
        makeInvite({ id: 'i-4', code: 'DDDD2345EEEE', status: 'exhausted', used_count: 5 }),
      ]),
    });
    renderWithProviders(<InvitesPage />);

    expect(await screen.findByText('Activă')).toBeInTheDocument();
    expect(screen.getByText('Expirată')).toBeInTheDocument();
    expect(screen.getByText('Epuizată')).toBeInTheDocument();
    // „Revocată" apare de două ori pe rândul revocat: eticheta de stare și
    // butonul dezactivat care spune de ce nu se mai poate apăsa.
    expect(screen.getAllByText('Revocată').length).toBeGreaterThanOrEqual(1);
  });

  it('spune clar când nu există nicio invitație', async () => {
    seedAdminSession();
    mockFetch(baseRoutes([]));
    renderWithProviders(<InvitesPage />);

    expect(await screen.findByText('Nicio invitație')).toBeInTheDocument();
  });

  it('arată eroarea serverului la încărcarea listei', async () => {
    seedAdminSession();
    mockFetch({
      ...baseRoutes(),
      [LIST]: { status: 500, body: { detail: 'Lista nu poate fi citită.' } },
    });
    renderWithProviders(<InvitesPage />);

    expect(await screen.findByText('Lista nu poate fi citită.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reîncearcă' })).toBeInTheDocument();
  });
});

describe('InvitesPage — filtrare', () => {
  it('filtrează pe SERVER după eveniment, când vine din pagina evenimentului', async () => {
    const { api } = await renderInvites({}, '/invites?event=e-2');

    await waitFor(() => expect(api.callsTo(LIST).length).toBeGreaterThan(0));
    expect(api.callsTo(LIST)[0]?.url).toContain('event_id=e-2');
    expect(await screen.findByTestId('invite-event-context')).toHaveTextContent('Concert de vară');
  });

  it('trimite un nou `event_id` când adminul schimbă filtrul', async () => {
    const { api, person } = await renderInvites();

    await screen.findByText('ABCD2345EFGH');
    await person.selectOptions(screen.getByLabelText('Eveniment'), 'e-1');

    await waitFor(() => {
      expect(api.callsTo(LIST).some((call) => call.url.includes('event_id=e-1'))).toBe(true);
    });
  });

  it('filtrează pe client după stare', async () => {
    seedAdminSession();
    mockFetch(
      baseRoutes([INVITE, makeInvite({ id: 'i-2', code: 'ZZZZ2345YYYY', status: 'revoked' })]),
    );
    const person = userEvent.setup();
    renderWithProviders(<InvitesPage />);
    await screen.findByText('ABCD2345EFGH');

    await person.selectOptions(screen.getByLabelText('Stare'), 'revoked');

    expect(screen.getByText('ZZZZ2345YYYY')).toBeInTheDocument();
    expect(screen.queryByText('ABCD2345EFGH')).not.toBeInTheDocument();
  });
});

describe('InvitesPage — emitere', () => {
  it('emite o invitație cu TOATE câmpurile completate', async () => {
    const { api, person } = await renderInvites({
      [CREATE]: { body: makeInvite({ code: 'NEWC2345ODE9' }) },
    });
    await screen.findByText('ABCD2345EFGH');

    const dialog = await openForm(person);
    await person.selectOptions(within(dialog).getByLabelText('Eveniment *'), 'e-1');
    await person.clear(within(dialog).getByLabelText('Număr maxim de folosiri *'));
    await person.type(within(dialog).getByLabelText('Număr maxim de folosiri *'), '10');
    await person.type(within(dialog).getByLabelText('Expiră la *'), datetimeLocalInDays(14));
    await person.selectOptions(within(dialog).getByLabelText('Treaptă minimă cerută'), 'silver');
    await person.type(within(dialog).getByLabelText('Reducere (%)'), '20');
    await person.type(within(dialog).getByLabelText('Notă internă'), 'Pentru parteneri');
    await person.click(within(dialog).getByRole('button', { name: 'Emite invitația' }));

    await waitFor(() => expect(api.callsTo(CREATE)).toHaveLength(1));
    expect(api.callsTo(CREATE)[0]?.body).toMatchObject({
      event_id: 'e-1',
      max_uses: 10,
      min_tier: 'silver',
      discount_percent: 20,
      note: 'Pentru parteneri',
    });
    // Codul NU se trimite niciodată de client: se generează pe server.
    expect(api.callsTo(CREATE)[0]?.body).not.toHaveProperty('code');
  });

  it('trimite `null` pentru câmpurile opționale lăsate goale', async () => {
    const { api, person } = await renderInvites({ [CREATE]: { body: INVITE } });
    await screen.findByText('ABCD2345EFGH');

    const dialog = await openForm(person);
    await person.selectOptions(within(dialog).getByLabelText('Eveniment *'), 'e-1');
    await person.type(within(dialog).getByLabelText('Expiră la *'), datetimeLocalInDays(3));
    await person.click(within(dialog).getByRole('button', { name: 'Emite invitația' }));

    await waitFor(() => expect(api.callsTo(CREATE)).toHaveLength(1));
    expect(api.callsTo(CREATE)[0]?.body).toMatchObject({
      min_tier: null,
      discount_percent: null,
      note: null,
      max_uses: 1,
    });
  });

  it('arată codul emis, evidențiat, ca să fie trimis imediat', async () => {
    const { person } = await renderInvites({
      [CREATE]: { body: makeInvite({ code: 'NEWC2345ODE9' }) },
    });
    await screen.findByText('ABCD2345EFGH');

    const dialog = await openForm(person);
    await person.selectOptions(within(dialog).getByLabelText('Eveniment *'), 'e-1');
    await person.type(within(dialog).getByLabelText('Expiră la *'), datetimeLocalInDays(3));
    await person.click(within(dialog).getByRole('button', { name: 'Emite invitația' }));

    const issued = await screen.findByTestId('issued-invite');
    expect(issued).toHaveTextContent('NEWC2345ODE9');
  });

  it('BLOCHEAZĂ o expirare în trecut (nu ajunge la server)', async () => {
    const { api, person } = await renderInvites({ [CREATE]: { body: INVITE } });
    await screen.findByText('ABCD2345EFGH');

    const dialog = await openForm(person);
    await person.selectOptions(within(dialog).getByLabelText('Eveniment *'), 'e-1');
    await person.type(within(dialog).getByLabelText('Expiră la *'), datetimeLocalInDays(-2));

    expect(await within(dialog).findByText(/în viitor/)).toBeInTheDocument();
    await person.click(within(dialog).getByRole('button', { name: 'Emite invitația' }));
    expect(api.callsTo(CREATE)).toHaveLength(0);
  });

  it('BLOCHEAZĂ emiterea fără eveniment ales', async () => {
    const { api, person } = await renderInvites({ [CREATE]: { body: INVITE } });
    await screen.findByText('ABCD2345EFGH');

    const dialog = await openForm(person);
    await person.type(within(dialog).getByLabelText('Expiră la *'), datetimeLocalInDays(5));

    expect(await within(dialog).findByText(/Alege evenimentul/)).toBeInTheDocument();
    await person.click(within(dialog).getByRole('button', { name: 'Emite invitația' }));
    expect(api.callsTo(CREATE)).toHaveLength(0);
  });

  it('arată mesajul serverului când emiterea e respinsă', async () => {
    const { api, person } = await renderInvites({
      [CREATE]: {
        status: 400,
        body: { detail: 'Expirarea nu poate depăși 365 de zile.' },
      },
    });
    await screen.findByText('ABCD2345EFGH');

    const dialog = await openForm(person);
    await person.selectOptions(within(dialog).getByLabelText('Eveniment *'), 'e-1');
    await person.type(within(dialog).getByLabelText('Expiră la *'), datetimeLocalInDays(5));
    await person.click(within(dialog).getByRole('button', { name: 'Emite invitația' }));

    await waitFor(() => expect(api.callsTo(CREATE)).toHaveLength(1));
    expect(await screen.findByText('Expirarea nu poate depăși 365 de zile.')).toBeInTheDocument();
  });
});

describe('InvitesPage — copierea codului', () => {
  it('copiază codul în clipboard și confirmă vizual', async () => {
    const { person } = await renderInvites();
    await screen.findByText('ABCD2345EFGH');

    const row = screen.getByText('ABCD2345EFGH').closest('tr') as HTMLElement;
    await person.click(within(row).getByRole('button', { name: 'Copiază' }));

    expect(await navigator.clipboard.readText()).toBe('ABCD2345EFGH');
    // Confirmarea vizuală: butonul își schimbă eticheta.
    expect(await within(row).findByRole('button', { name: 'Copiat!' })).toBeInTheDocument();
  });
});

describe('InvitesPage — revocare', () => {
  it('cere confirmare înainte de a revoca', async () => {
    const { api, person } = await renderInvites({
      [REVOKE]: { body: makeInvite({ status: 'revoked', revoked_at: isoInDays(0) }) },
    });
    await screen.findByText('ABCD2345EFGH');

    await person.click(screen.getByRole('button', { name: 'Revocă' }));
    const dialog = await screen.findByRole('dialog');
    // Nimic nu pleacă la server doar pentru că s-a deschis dialogul.
    expect(api.callsTo(REVOKE)).toHaveLength(0);
    expect(dialog).toHaveTextContent('Folosiri consumate: 2 din 5.');
    // Codul NU se repetă în confirmare (ca și în jurnalul de audit al backendului).
    expect(dialog).not.toHaveTextContent('ABCD2345EFGH');

    await person.click(within(dialog).getByRole('button', { name: 'Revocă invitația' }));
    await waitFor(() => expect(api.callsTo(REVOKE)).toHaveLength(1));
  });

  it('nu revocă nimic dacă adminul renunță', async () => {
    const { api, person } = await renderInvites({ [REVOKE]: { body: INVITE } });
    await screen.findByText('ABCD2345EFGH');

    await person.click(screen.getByRole('button', { name: 'Revocă' }));
    const dialog = await screen.findByRole('dialog');
    await person.click(within(dialog).getByRole('button', { name: 'Anulează' }));

    expect(api.callsTo(REVOKE)).toHaveLength(0);
  });

  it('arată mesajul serverului când revocarea eșuează', async () => {
    const { api, person } = await renderInvites({
      [REVOKE]: { status: 404, body: { detail: 'Invite not found' } },
    });
    await screen.findByText('ABCD2345EFGH');

    await person.click(screen.getByRole('button', { name: 'Revocă' }));
    const dialog = await screen.findByRole('dialog');
    await person.click(within(dialog).getByRole('button', { name: 'Revocă invitația' }));

    await waitFor(() => expect(api.callsTo(REVOKE)).toHaveLength(1));
    expect(await screen.findByText(/Ruta nu există pe backend/)).toBeInTheDocument();
  });

  it('nu oferă revocare pentru o invitație deja revocată', async () => {
    seedAdminSession();
    mockFetch(
      baseRoutes([makeInvite({ status: 'revoked', revoked_at: isoInDays(-1) })]),
    );
    renderWithProviders(<InvitesPage />);
    await screen.findByText('ABCD2345EFGH');

    expect(screen.getByRole('button', { name: 'Revocată' })).toBeDisabled();
  });
});
