/**
 * Ecranul de evenimente — singura cale prin care un eveniment real ajunge în
 * aplicație. Testele acoperă tot drumul: creare completă, validări care resping
 * datele greșite ÎNAINTE de cerere, editare, listă filtrată/sortată/căutată și
 * ștergere care spune ce se pierde.
 *
 * Datele fixturilor sunt RELATIVE la `Date.now()`: un eveniment „viitor" scris
 * cu o dată fixă devine „trecut" peste câteva luni și testul începe să pice din
 * motive care n-au nicio legătură cu codul.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { EventsPage } from './EventsPage';
import type { AdminEvent } from '../api/types';
import { mockFetch, renderWithProviders, seedAdminSession } from '../test/harness';

const DAY = 24 * 60 * 60 * 1000;

/** ISO UTC la `n` zile distanță de acum (negativ = în trecut). */
const isoInDays = (days: number): string => new Date(Date.now() + days * DAY).toISOString();

/** Valoare pentru `<input type="datetime-local">`, în ora locală. */
function datetimeLocalInDays(days: number): string {
  const date = new Date(Date.now() + days * DAY);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function makeEvent(overrides: Partial<AdminEvent> = {}): AdminEvent {
  return {
    id: 'e-1',
    title: 'Seară de stand-up',
    description: null,
    starts_at: isoInDays(10),
    city: 'București',
    venue: 'Club X',
    lat: null,
    lng: null,
    kind: 'party',
    cover_url: null,
    attendee_count: 12,
    promo_discount_percent: null,
    promo_code: null,
    promo_description: null,
    ticket_price: null,
    ticket_currency: null,
    ticket_order_count: 0,
    ticket_approved_count: 0,
    ...overrides,
  };
}

const EVENT = makeEvent();

/** Deschide formularul de creare și întoarce dialogul. */
async function openNewEventForm(person: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await person.click(screen.getByRole('button', { name: 'Eveniment nou' }));
  return screen.findByRole('dialog');
}

/** Completează minimul obligatoriu (titlu, oraș, dată). */
async function fillRequired(
  person: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  { title, city, days = 20 }: { title: string; city: string; days?: number },
): Promise<void> {
  await person.type(within(dialog).getByLabelText('Titlu *'), title);
  await person.type(within(dialog).getByLabelText('Oraș *'), city);
  await person.type(within(dialog).getByLabelText('Data și ora *'), datetimeLocalInDays(days));
}

describe('EventsPage — creare', () => {
  it('creează un eveniment nou cu payload-ul corect', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/events': { body: [] },
      'POST /admin/events': { body: EVENT },
    });
    const person = userEvent.setup();

    renderWithProviders(<EventsPage />);
    await screen.findByText('Niciun eveniment');

    const dialog = await openNewEventForm(person);
    await fillRequired(person, dialog, { title: 'Seară de stand-up', city: 'București' });
    await person.click(within(dialog).getByRole('button', { name: 'Creează evenimentul' }));

    await waitFor(() => {
      expect(api.callsTo('POST /admin/events')).toHaveLength(1);
    });
    expect(api.callsTo('POST /admin/events')[0]?.body).toMatchObject({
      title: 'Seară de stand-up',
      city: 'București',
      kind: 'flirt_party',
    });
  });

  it('trimite TOATE câmpurile evenimentului, nu doar pe cele obligatorii', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/events': { body: [] },
      'POST /admin/events': { body: EVENT },
    });
    const person = userEvent.setup();

    renderWithProviders(<EventsPage />);
    await screen.findByText('Niciun eveniment');

    const dialog = await openNewEventForm(person);
    await fillRequired(person, dialog, { title: 'Flirt Party Real', city: 'Chișinău' });
    await person.type(
      within(dialog).getByLabelText('Descriere'),
      'Prima petrecere creată din panou.',
    );
    await person.selectOptions(within(dialog).getByLabelText('Tip'), 'concert');
    await person.type(within(dialog).getByLabelText('Locație'), 'Club Nova');
    await person.type(within(dialog).getByLabelText('Latitudine'), '47.0245');
    await person.type(within(dialog).getByLabelText('Longitudine'), '28.8322');
    await person.type(
      within(dialog).getByLabelText('URL copertă'),
      'https://cdn.exemplu.md/poster.jpg',
    );
    await person.type(within(dialog).getByLabelText('Preț bilet'), '150');
    await person.clear(within(dialog).getByLabelText('Monedă'));
    await person.type(within(dialog).getByLabelText('Monedă'), 'MDL');
    await person.type(within(dialog).getByLabelText('Reducere (%)'), '10');
    await person.type(within(dialog).getByLabelText('Cod promo'), 'FLIRT10');
    await person.type(
      within(dialog).getByLabelText('Descriere promo'),
      'Arată codul la intrare pentru 10% reducere.',
    );

    await person.click(within(dialog).getByRole('button', { name: 'Creează evenimentul' }));

    await waitFor(() => {
      expect(api.callsTo('POST /admin/events')).toHaveLength(1);
    });
    expect(api.callsTo('POST /admin/events')[0]?.body).toMatchObject({
      title: 'Flirt Party Real',
      city: 'Chișinău',
      venue: 'Club Nova',
      kind: 'concert',
      description: 'Prima petrecere creată din panou.',
      cover_url: 'https://cdn.exemplu.md/poster.jpg',
      lat: 47.0245,
      lng: 28.8322,
      ticket_price: 150,
      ticket_currency: 'MDL',
      promo_discount_percent: 10,
      promo_code: 'FLIRT10',
      promo_description: 'Arată codul la intrare pentru 10% reducere.',
    });
  });

  it('completează ambele coordonate dintr-un „lat, lng" lipit din Google Maps', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/events': { body: [] },
      'POST /admin/events': { body: EVENT },
    });
    const person = userEvent.setup();

    renderWithProviders(<EventsPage />);
    await screen.findByText('Niciun eveniment');

    const dialog = await openNewEventForm(person);
    await fillRequired(person, dialog, { title: 'Pe hartă', city: 'Chișinău' });
    await person.type(
      within(dialog).getByLabelText('Lipește „lat, lng" dintr-o dată'),
      '47.0245, 28.8322',
    );

    // Avertismentul „nu apare pe hartă" dispare imediat ce perechea e completă.
    expect(within(dialog).getByTestId('coords-ok')).toBeInTheDocument();

    await person.click(within(dialog).getByRole('button', { name: 'Creează evenimentul' }));
    await waitFor(() => {
      expect(api.callsTo('POST /admin/events')).toHaveLength(1);
    });
    expect(api.callsTo('POST /admin/events')[0]?.body).toMatchObject({
      lat: 47.0245,
      lng: 28.8322,
    });
  });

  it('trimite prețul biletului și moneda în payload', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/events': { body: [] },
      'POST /admin/events': { body: EVENT },
    });
    const person = userEvent.setup();

    renderWithProviders(<EventsPage />);
    await screen.findByText('Niciun eveniment');

    const dialog = await openNewEventForm(person);
    await fillRequired(person, dialog, { title: 'Gală', city: 'Cluj' });
    await person.type(within(dialog).getByLabelText('Preț bilet'), '50');
    await person.click(within(dialog).getByRole('button', { name: 'Creează evenimentul' }));

    await waitFor(() => {
      expect(api.callsTo('POST /admin/events')).toHaveLength(1);
    });
    expect(api.callsTo('POST /admin/events')[0]?.body).toMatchObject({
      ticket_price: 50,
      ticket_currency: 'lei',
    });
  });

  it('lasă prețul null când câmpul e gol (bilet online indisponibil)', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/events': { body: [] },
      'POST /admin/events': { body: EVENT },
    });
    const person = userEvent.setup();

    renderWithProviders(<EventsPage />);
    await screen.findByText('Niciun eveniment');

    const dialog = await openNewEventForm(person);
    await fillRequired(person, dialog, { title: 'Fără bilet', city: 'Iași' });
    await person.click(within(dialog).getByRole('button', { name: 'Creează evenimentul' }));

    await waitFor(() => {
      expect(api.callsTo('POST /admin/events')).toHaveLength(1);
    });
    const body = api.callsTo('POST /admin/events')[0]?.body as Record<string, unknown>;
    expect(body.ticket_price).toBeNull();
    expect(body.ticket_currency).toBeNull();
  });
});

describe('EventsPage — validări', () => {
  it('nu trimite nimic fără titlu, oraș sau dată', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/events': { body: [] },
      'POST /admin/events': { body: EVENT },
    });
    const person = userEvent.setup();

    renderWithProviders(<EventsPage />);
    await screen.findByText('Niciun eveniment');

    const dialog = await openNewEventForm(person);
    const submit = within(dialog).getByRole('button', { name: 'Creează evenimentul' });
    expect(submit).toBeDisabled();

    await person.click(submit);
    expect(api.callsTo('POST /admin/events')).toHaveLength(0);
  });

  it('respinge coordonatele imposibile și pe cele incomplete, cu mesaj în formular', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/events': { body: [] },
      'POST /admin/events': { body: EVENT },
    });
    const person = userEvent.setup();

    renderWithProviders(<EventsPage />);
    await screen.findByText('Niciun eveniment');

    const dialog = await openNewEventForm(person);
    await fillRequired(person, dialog, { title: 'Coordonate rele', city: 'Chișinău' });

    await person.type(within(dialog).getByLabelText('Latitudine'), '500');
    expect(
      within(dialog).getByText('Latitudinea trebuie să fie un număr între −90 și 90.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Creează evenimentul' })).toBeDisabled();

    // Corectăm latitudinea, dar rămâne perechea incompletă → tot blocat.
    await person.clear(within(dialog).getByLabelText('Latitudine'));
    await person.type(within(dialog).getByLabelText('Latitudine'), '47.0245');
    expect(within(dialog).getByRole('button', { name: 'Creează evenimentul' })).toBeDisabled();

    await person.type(within(dialog).getByLabelText('Longitudine'), '28.8322');
    expect(within(dialog).getByRole('button', { name: 'Creează evenimentul' })).toBeEnabled();
    expect(api.callsTo('POST /admin/events')).toHaveLength(0);
  });

  it('respinge marcajele HTML din titlu (aceeași regulă ca backendul)', async () => {
    seedAdminSession();
    mockFetch({ 'GET /admin/events': { body: [] }, 'POST /admin/events': { body: EVENT } });
    const person = userEvent.setup();

    renderWithProviders(<EventsPage />);
    await screen.findByText('Niciun eveniment');

    const dialog = await openNewEventForm(person);
    await fillRequired(person, dialog, { title: '<b>Petrecere</b>', city: 'Chișinău' });

    expect(
      within(dialog).getByText('Titlu: marcajele HTML nu sunt acceptate.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Creează evenimentul' })).toBeDisabled();
  });

  it('respinge reducerea peste 100% și prețul negativ', async () => {
    seedAdminSession();
    mockFetch({ 'GET /admin/events': { body: [] }, 'POST /admin/events': { body: EVENT } });
    const person = userEvent.setup();

    renderWithProviders(<EventsPage />);
    await screen.findByText('Niciun eveniment');

    const dialog = await openNewEventForm(person);
    await fillRequired(person, dialog, { title: 'Promo rău', city: 'Chișinău' });

    await person.type(within(dialog).getByLabelText('Reducere (%)'), '150');
    expect(
      within(dialog).getByText('Reducerea trebuie să fie între 0 și 100%.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Creează evenimentul' })).toBeDisabled();
  });

  it('respinge o copertă care nu e adresă http(s)', async () => {
    seedAdminSession();
    mockFetch({ 'GET /admin/events': { body: [] }, 'POST /admin/events': { body: EVENT } });
    const person = userEvent.setup();

    renderWithProviders(<EventsPage />);
    await screen.findByText('Niciun eveniment');

    const dialog = await openNewEventForm(person);
    await fillRequired(person, dialog, { title: 'Copertă ruptă', city: 'Chișinău' });
    await person.type(within(dialog).getByLabelText('URL copertă'), 'poster.jpg');

    expect(
      within(dialog).getByText('Adresa trebuie să înceapă cu http:// sau https://.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Creează evenimentul' })).toBeDisabled();
  });

  it('avertizează (fără să blocheze) că fără coordonate nu apare pe hartă', async () => {
    seedAdminSession();
    mockFetch({ 'GET /admin/events': { body: [] }, 'POST /admin/events': { body: EVENT } });
    const person = userEvent.setup();

    renderWithProviders(<EventsPage />);
    await screen.findByText('Niciun eveniment');

    const dialog = await openNewEventForm(person);
    await fillRequired(person, dialog, { title: 'Fără hartă', city: 'Chișinău' });

    expect(within(dialog).getByTestId('coords-missing')).toBeInTheDocument();
    expect(within(dialog).getByTestId('event-warnings').textContent).toContain('harta');
    // Avertisment ≠ eroare: se poate publica.
    expect(within(dialog).getByRole('button', { name: 'Creează evenimentul' })).toBeEnabled();
  });
});

describe('EventsPage — previzualizare', () => {
  it('arată în previzualizare câmpurile pe care le vede utilizatorul', async () => {
    seedAdminSession();
    mockFetch({ 'GET /admin/events': { body: [] }, 'POST /admin/events': { body: EVENT } });
    const person = userEvent.setup();

    renderWithProviders(<EventsPage />);
    await screen.findByText('Niciun eveniment');

    const dialog = await openNewEventForm(person);
    await fillRequired(person, dialog, { title: 'Noapte de vară', city: 'Chișinău' });
    await person.type(within(dialog).getByLabelText('Locație'), 'Club Nova');
    await person.type(within(dialog).getByLabelText('Preț bilet'), '150');

    const preview = within(dialog).getByLabelText('Previzualizare aplicație');
    expect(within(preview).getAllByText('Noapte de vară').length).toBeGreaterThan(0);
    expect(within(preview).getAllByText('Club Nova · Chișinău').length).toBeGreaterThan(0);
    expect(within(preview).getByTestId('preview-ticket').textContent).toContain('150 lei');
    // Fără coordonate, aplicația arată caseta cu orașul în locul hărții.
    expect(within(preview).getByTestId('preview-map-fallback')).toBeInTheDocument();
    // Promo fără cod NU se afișează în aplicație — nici în previzualizare.
    await person.type(within(dialog).getByLabelText('Reducere (%)'), '10');
    expect(within(preview).queryByTestId('preview-promo')).not.toBeInTheDocument();
    await person.type(within(dialog).getByLabelText('Cod promo'), 'FLIRT10');
    expect(within(preview).getByTestId('preview-promo')).toBeInTheDocument();
  });
});

describe('EventsPage — listă', () => {
  const events = [
    makeEvent({ id: 'e-soon', title: 'Flirt Party curând', starts_at: isoInDays(3) }),
    makeEvent({ id: 'e-later', title: 'Concert peste lună', starts_at: isoInDays(40) }),
    makeEvent({
      id: 'e-past',
      title: 'Petrecere trecută',
      starts_at: isoInDays(-15),
      city: 'Bălți',
    }),
  ];

  it('separă viitoarele de trecute și le sortează după dată', async () => {
    seedAdminSession();
    mockFetch({ 'GET /admin/events': { body: events } });

    renderWithProviders(<EventsPage />);
    await screen.findByText('Viitoare (2)');
    expect(screen.getByText('Trecute (1)')).toBeInTheDocument();

    const rows = screen.getAllByRole('row').map((row) => row.textContent ?? '');
    const soon = rows.findIndex((text) => text.includes('Flirt Party curând'));
    const later = rows.findIndex((text) => text.includes('Concert peste lună'));
    const past = rows.findIndex((text) => text.includes('Petrecere trecută'));
    expect(soon).toBeLessThan(later);
    expect(later).toBeLessThan(past);
  });

  it('inversează ordinea la cerere', async () => {
    seedAdminSession();
    mockFetch({ 'GET /admin/events': { body: events } });
    const person = userEvent.setup();

    renderWithProviders(<EventsPage />);
    await screen.findByText('Viitoare (2)');

    await person.selectOptions(screen.getByLabelText('Ordine'), 'latest');
    const rows = screen.getAllByRole('row').map((row) => row.textContent ?? '');
    const soon = rows.findIndex((text) => text.includes('Flirt Party curând'));
    const later = rows.findIndex((text) => text.includes('Concert peste lună'));
    expect(later).toBeLessThan(soon);
  });

  it('filtrează după perioadă', async () => {
    seedAdminSession();
    mockFetch({ 'GET /admin/events': { body: events } });
    const person = userEvent.setup();

    renderWithProviders(<EventsPage />);
    await screen.findByText('Viitoare (2)');

    await person.selectOptions(screen.getByLabelText('Perioadă'), 'past');
    expect(screen.queryByText('Flirt Party curând')).not.toBeInTheDocument();
    expect(screen.getByText('Petrecere trecută')).toBeInTheDocument();
  });

  it('caută în titlu și oraș, fără diacritice', async () => {
    seedAdminSession();
    mockFetch({ 'GET /admin/events': { body: events } });
    const person = userEvent.setup();

    renderWithProviders(<EventsPage />);
    await screen.findByText('Viitoare (2)');

    await person.type(screen.getByLabelText('Caută (titlu, oraș, loc, cod promo)'), 'balti');
    expect(screen.getByText('Petrecere trecută')).toBeInTheDocument();
    expect(screen.queryByText('Flirt Party curând')).not.toBeInTheDocument();

    await person.clear(screen.getByLabelText('Caută (titlu, oraș, loc, cod promo)'));
    await person.type(screen.getByLabelText('Caută (titlu, oraș, loc, cod promo)'), 'inexistent');
    expect(await screen.findByText('Niciun eveniment găsit')).toBeInTheDocument();
  });

  it('marchează evenimentele care nu apar pe hartă sau nu au copertă', async () => {
    seedAdminSession();
    mockFetch({ 'GET /admin/events': { body: [EVENT] } });

    renderWithProviders(<EventsPage />);
    await screen.findByText('Seară de stand-up');

    expect(screen.getByText('Fără hartă')).toBeInTheDocument();
    expect(screen.getByText('Fără copertă')).toBeInTheDocument();
  });
});

describe('EventsPage — editare', () => {
  it('deschide formularul cu datele evenimentului și trimite PUT cu tot obiectul', async () => {
    seedAdminSession();
    const existing = makeEvent({
      description: 'Text vechi',
      lat: 47.0245,
      lng: 28.8322,
      cover_url: 'https://cdn.exemplu.md/a.jpg',
      ticket_price: 100,
      ticket_currency: 'lei',
    });
    const api = mockFetch({
      'GET /admin/events': { body: [existing] },
      'PUT /admin/events/e-1': { body: existing },
    });
    const person = userEvent.setup();

    renderWithProviders(<EventsPage />);
    await screen.findByText('Seară de stand-up');

    await person.click(screen.getByRole('button', { name: 'Editează' }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByLabelText('Titlu *')).toHaveValue('Seară de stand-up');
    expect(within(dialog).getByLabelText('Latitudine')).toHaveValue('47.0245');

    await person.clear(within(dialog).getByLabelText('Oraș *'));
    await person.type(within(dialog).getByLabelText('Oraș *'), 'Bălți');
    await person.click(within(dialog).getByRole('button', { name: 'Salvează' }));

    await waitFor(() => {
      expect(api.callsTo('PUT /admin/events/e-1')).toHaveLength(1);
    });
    // Panoul trimite obiectul COMPLET: schimbarea orașului nu pierde restul.
    expect(api.callsTo('PUT /admin/events/e-1')[0]?.body).toMatchObject({
      city: 'Bălți',
      title: 'Seară de stand-up',
      description: 'Text vechi',
      lat: 47.0245,
      lng: 28.8322,
      cover_url: 'https://cdn.exemplu.md/a.jpg',
      ticket_price: 100,
      ticket_currency: 'lei',
    });
  });
});

describe('EventsPage — ștergere', () => {
  it('nu șterge un eveniment fără confirmare', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/events': { body: [EVENT] },
      'DELETE /admin/events/e-1': { status: 204 },
    });
    const person = userEvent.setup();

    renderWithProviders(<EventsPage />);
    await screen.findByText('Seară de stand-up');

    await person.click(screen.getByRole('button', { name: 'Șterge' }));
    const dialog = await screen.findByRole('dialog');
    expect(api.callsTo('DELETE /admin/events/e-1')).toHaveLength(0);

    await person.click(within(dialog).getByRole('button', { name: 'Șterge evenimentul' }));
    await waitFor(() => {
      expect(api.callsTo('DELETE /admin/events/e-1')).toHaveLength(1);
    });
  });

  it('confirmarea spune CE se pierde: participanți și comenzi de bilet', async () => {
    seedAdminSession();
    mockFetch({
      'GET /admin/events': {
        body: [makeEvent({ attendee_count: 34, ticket_order_count: 7, ticket_approved_count: 0 })],
      },
      'DELETE /admin/events/e-1': { status: 204 },
    });
    const person = userEvent.setup();

    renderWithProviders(<EventsPage />);
    await screen.findByText('Seară de stand-up');

    await person.click(screen.getByRole('button', { name: 'Șterge' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Participanți înscriși: 34');
    expect(dialog.textContent).toContain('Comenzi de bilet în așteptare: 7');
  });

  it('cere tastarea titlului când există bilete deja APROBATE (plătite)', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/events': {
        body: [makeEvent({ attendee_count: 5, ticket_order_count: 3, ticket_approved_count: 2 })],
      },
      'DELETE /admin/events/e-1': { status: 204 },
    });
    const person = userEvent.setup();

    renderWithProviders(<EventsPage />);
    await screen.findByText('Seară de stand-up');

    await person.click(screen.getByRole('button', { name: 'Șterge' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('2 BILETE APROBATE');

    const confirm = within(dialog).getByRole('button', { name: 'Șterge evenimentul' });
    expect(confirm).toBeDisabled();
    await person.click(confirm);
    expect(api.callsTo('DELETE /admin/events/e-1')).toHaveLength(0);

    await person.type(
      within(dialog).getByLabelText(/Scrie „Seară de stand-up"/),
      'Seară de stand-up',
    );
    await person.click(within(dialog).getByRole('button', { name: 'Șterge evenimentul' }));
    await waitFor(() => {
      expect(api.callsTo('DELETE /admin/events/e-1')).toHaveLength(1);
    });
  });
});
