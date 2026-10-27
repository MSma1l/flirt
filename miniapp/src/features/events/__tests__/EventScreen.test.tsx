/**
 * Detaliul evenimentului: randare, bilet online, participare, check-in.
 *
 * Două mock-uri, din două motive diferite:
 *   - `../eventsApi` — ca testele să verifice deciziile ecranului, nu axios;
 *   - `leaflet` — harta e testată separat, cu biblioteca adevărată
 *     (`EventMap.test.tsx`). Aici ar adăuga doar dependență de layout-ul din
 *     jsdom și zeci de milisecunde la fiecare test.
 *
 * Regula verificată peste tot mai jos: o acțiune EȘUATĂ scrie un mesaj în
 * pagină și NU golește ecranul. Datele evenimentului rămân pe loc.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TicketOrderDetail as MobileTicketOrderDetail } from '@mobile/features/tickets/types';

import type { TicketQuote } from '@/features/loyalty';
import { TICKETS_PATH } from '@/features/tickets/ticketRoutes';
import type { EventItem, TicketOrder } from '../eventsApi';
import { renderWithProviders } from '@/test/harness';

import { EventScreen } from '../EventScreen';
import { EVENT_ROUTE_PATTERN } from '../eventRoutes';

vi.mock('../eventsApi', () => ({
  fetchEvents: vi.fn(),
  fetchEvent: vi.fn(),
  setGoing: vi.fn(),
  checkin: vi.fn(),
  fetchMyTicketOrders: vi.fn(),
  createTicketOrder: vi.fn(),
}));

// Cotația de preț (`features/loyalty`): prețul biletului NU mai vine din
// `Event`, ci de la server, calculat pentru utilizatorul curent. Implicit o
// lăsăm să pice, ca restul testelor să vadă comportamentul de rezervă — prețul
// de listă. Testele de preț și-o mochează cum au nevoie.
vi.mock('@/features/loyalty/loyaltyApi', () => ({
  fetchTicketQuote: vi.fn(),
  fetchLoyaltyStatus: vi.fn(),
  redeemInvite: vi.fn(),
}));

// Harta: un dublu minimal care imită lanțul `L.x(...).addTo(map)` din Leaflet.
vi.mock('leaflet', () => {
  const layer = {
    addTo: vi.fn(() => layer),
    bindPopup: vi.fn(() => layer),
  };
  return {
    map: vi.fn(() => ({
      remove: vi.fn(),
      invalidateSize: vi.fn(),
      setView: vi.fn(),
      getZoom: vi.fn(() => 15),
    })),
    tileLayer: vi.fn(() => layer),
    marker: vi.fn(() => layer),
    divIcon: vi.fn(() => ({})),
    Browser: { mobile: false },
  };
});

const { checkin, createTicketOrder, fetchEvent, fetchMyTicketOrders, setGoing } =
  await import('../eventsApi');
const { fetchTicketQuote } = await import('@/features/loyalty/loyaltyApi');

/** Cotația unui bilet de 150 de lei, așa cum o întoarce serverul. */
const QUOTE: TicketQuote = {
  eventId: 'e1',
  basePrice: 150,
  currency: 'lei',
  loyaltyPercent: 0,
  promoPercent: 0,
  invitePercent: 0,
  appliedPercent: 0,
  appliedSource: 'none',
  capped: false,
  discountAmount: 0,
  finalPrice: 150,
  tier: null,
};

const EVENT: EventItem = {
  id: 'e1',
  title: 'Flirt Party Chișinău',
  description: 'Seară de cunoștințe, muzică live și jocuri.',
  startsAt: '2027-07-04T19:00:00.000Z',
  city: 'Chișinău',
  venue: 'Club Mono',
  lat: 47.0245,
  lng: 28.8322,
  kind: 'flirt_party',
  attendeeCount: 42,
  iAmGoing: false,
  promoDiscountPercent: 20,
  promoCode: 'FLIRT20',
  promoDescription: 'Valabil doar în seara evenimentului.',
  ticketPrice: 150,
  ticketCurrency: 'lei',
};

/** Variantă minimală: fără promo, fără bilet online, fără coordonate. */
const BARE_EVENT: EventItem = {
  ...EVENT,
  lat: undefined,
  lng: undefined,
  promoDiscountPercent: null,
  promoCode: null,
  promoDescription: null,
  ticketPrice: null,
  ticketCurrency: null,
};

const ORDER: TicketOrder = {
  id: 'o1',
  eventId: 'e1',
  eventTitle: 'Flirt Party Chișinău',
  eventStartsAt: '2027-07-04T19:00:00.000Z',
  status: 'awaiting_payment',
  price: 150,
  currency: 'lei',
  reference: '482719',
  ticketCode: null,
  createdAt: '2026-07-01T10:00:00.000Z',
};

/** Comanda nou creată, cum o întoarce `createTicketOrder` (forma mobilă). */
const CREATED: MobileTicketOrderDetail = {
  order: { id: 'o1', eventId: 'e1', status: 'awaiting_payment', price: 150, currency: 'lei', ticketCode: null },
  payment: null,
};

/** O eroare axios cu cod stabil, ca de la `CodedHTTPException`. */
function codedError(status: number, code: string) {
  return Object.assign(new Error(code), { response: { status, data: { detail: '…', code } } });
}

const HOUR = 60 * 60 * 1000;

/** Ținta navigării: arată și query-ul, ca să vedem ce comandă se deschide. */
function TicketsProbe() {
  const location = useLocation();
  return <div data-testid="tickets-screen">{location.search}</div>;
}

function renderDetail() {
  return renderWithProviders(
    <MemoryRouter initialEntries={['/events/e1']}>
      <Routes>
        <Route path={EVENT_ROUTE_PATTERN} element={<EventScreen />} />
        {/* Ținta navigărilor legate de bilet, ca să le putem observa. */}
        <Route path={TICKETS_PATH} element={<TicketsProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(fetchEvent).mockResolvedValue(EVENT);
  vi.mocked(fetchMyTicketOrders).mockResolvedValue([]);
  vi.mocked(fetchTicketQuote).mockRejectedValue(new Error('no quote'));
});

describe('randarea detaliului', () => {
  it('arată un indicator cât timp datele nu au sosit', () => {
    vi.mocked(fetchEvent).mockReturnValue(new Promise<EventItem>(() => {}));
    renderDetail();

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('cere evenimentul din URL și arată tipul, titlul, locul, promo și participanții', async () => {
    renderDetail();

    expect(await screen.findByText('Flirt Party Chișinău')).toBeInTheDocument();
    expect(fetchEvent).toHaveBeenCalledWith('e1');

    expect(screen.getByText('Flirt Party')).toBeInTheDocument();
    // Locul: sala ca valoare principală, orașul dedesubt, în rândul „Unde".
    const place = screen.getByTestId('event-fact-place');
    expect(place).toHaveTextContent('Unde');
    expect(place).toHaveTextContent('Club Mono');
    expect(place).toHaveTextContent('Chișinău');
    expect(screen.getByTestId('event-fact-date')).toHaveTextContent('Când');
    expect(screen.getByText('Despre eveniment')).toBeInTheDocument();
    expect(screen.getByText('Seară de cunoștințe, muzică live și jocuri.')).toBeInTheDocument();
    expect(screen.getByTestId('event-fact-attendees')).toHaveTextContent('42 participanți');
    expect(screen.getByText('42 participanți')).toBeInTheDocument();

    const promo = screen.getByTestId('event-promo');
    expect(promo).toHaveTextContent('Reducere la intrare −20%');
    expect(screen.getByTestId('event-promo-code')).toHaveTextContent('FLIRT20');
    expect(promo).toHaveTextContent('Valabil doar în seara evenimentului.');
  });

  it('un eveniment fără promo, fără bilet și fără coordonate nu inventează secțiuni goale', async () => {
    vi.mocked(fetchEvent).mockResolvedValue(BARE_EVENT);
    renderDetail();

    await screen.findByText('Flirt Party Chișinău');

    expect(screen.queryByTestId('event-promo')).not.toBeInTheDocument();
    expect(screen.queryByTestId('buy-ticket-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ticket-status')).not.toBeInTheDocument();
    // Fără coordonate → caseta cu orașul, nu o hartă goală.
    expect(screen.getByTestId('event-map-fallback')).toHaveTextContent('📍 Chișinău');
  });

  it('posterul aplică încadrarea setată de admin (punct focal + zoom)', async () => {
    vi.mocked(fetchEvent).mockResolvedValue({
      ...EVENT,
      coverUrl: 'https://cdn.example.com/poster.jpg',
      coverFocusX: 0.25,
      coverFocusY: 0.8,
      coverZoom: 1.5,
    });
    renderDetail();

    await screen.findByText('Flirt Party Chișinău');
    const img = screen.getByTestId('event-hero').querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.style.objectPosition).toBe('25% 80%');
    expect(img?.style.transform).toBe('scale(1.5)');
  });

  it('cu coordonate, harta are buton „Deschide în hărți" spre locație', async () => {
    renderDetail();

    await screen.findByText('Flirt Party Chișinău');
    expect(screen.getByTestId('event-map')).toBeInTheDocument();
    const open = screen.getByTestId('event-map-open');
    expect(open).toHaveTextContent('Deschide în hărți');
    expect(open.getAttribute('href')).toContain('query=47.024500,28.832200');
  });

  it('eroarea de încărcare se anunță și se poate reîncerca cu succes', async () => {
    vi.mocked(fetchEvent).mockRejectedValueOnce(new Error('offline'));
    renderDetail();

    expect(await screen.findByTestId('event-error')).toHaveTextContent(
      'Nu am putut încărca evenimentul.',
    );

    vi.mocked(fetchEvent).mockResolvedValue(EVENT);
    fireEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }));

    expect(await screen.findByText('Flirt Party Chișinău')).toBeInTheDocument();
    expect(screen.queryByTestId('event-error')).not.toBeInTheDocument();
  });
});

describe('participare', () => {
  it('confirmarea reușită schimbă butonul în „Nu mai merg"', async () => {
    const going: EventItem = { ...EVENT, iAmGoing: true, attendeeCount: 43 };
    vi.mocked(setGoing).mockResolvedValue(going);
    // Prima interogare întoarce evenimentul neconfirmat; reinterogarea de după
    // invalidarea cheii `['event', 'e1']` întoarce varianta „merg".
    vi.mocked(fetchEvent).mockResolvedValueOnce(EVENT).mockResolvedValue(going);
    renderDetail();

    fireEvent.click(await screen.findByTestId('going-btn'));

    await waitFor(() => expect(setGoing).toHaveBeenCalledWith('e1', true));

    expect(await screen.findByRole('button', { name: 'Nu mai merg' })).toBeInTheDocument();
    expect(screen.getByText('43 participanți')).toBeInTheDocument();
  });

  it('eșecul scrie mesajul în pagină și NU golește ecranul', async () => {
    vi.mocked(setGoing).mockRejectedValue(new Error('500'));
    renderDetail();

    fireEvent.click(await screen.findByTestId('going-btn'));

    expect(
      await screen.findByText('Nu am putut actualiza participarea. Reîncearcă.'),
    ).toBeInTheDocument();
    // Datele evenimentului sunt tot acolo.
    expect(screen.getByText('Flirt Party Chișinău')).toBeInTheDocument();
    expect(screen.getByTestId('going-btn')).toBeEnabled();
  });
});

describe('check-in', () => {
  it('nu mai oferă check-in din aplicație: ștampila vine la scanarea de la intrare', async () => {
    renderDetail();

    expect(await screen.findByText('Flirt Party Chișinău')).toBeInTheDocument();
    expect(screen.queryByTestId('checkin-btn')).not.toBeInTheDocument();
    expect(checkin).not.toHaveBeenCalled();
  });
});

describe('bilet online', () => {
  it('fără comandă, arată butonul de cumpărare cu preț și duce la ecranul de bilete', async () => {
    vi.mocked(createTicketOrder).mockResolvedValue(CREATED);
    renderDetail();

    const buy = await screen.findByTestId('buy-ticket-btn');
    expect(buy).toHaveTextContent('Cumpără bilet online — 150 lei');

    fireEvent.click(buy);

    await waitFor(() => expect(createTicketOrder).toHaveBeenCalledWith('e1'));
    // Ajunge pe ecranul de bilete cu comanda nouă deja deschisă.
    expect(await screen.findByTestId('tickets-screen')).toHaveTextContent('?order=o1');
  });

  it('eșecul comenzii se vede în pagină, iar butonul rămâne apăsabil', async () => {
    vi.mocked(createTicketOrder).mockRejectedValue(new Error('502'));
    renderDetail();

    fireEvent.click(await screen.findByTestId('buy-ticket-btn'));

    expect(
      await screen.findByText('Nu am putut crea comanda. Reîncearcă.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('buy-ticket-btn')).toBeEnabled();
    expect(screen.queryByTestId('tickets-screen')).not.toBeInTheDocument();
  });

  it('cu o comandă activă, arată starea ei în locul butonului de cumpărare', async () => {
    vi.mocked(fetchMyTicketOrders).mockResolvedValue([
      { ...ORDER, id: 'o-vechi', status: 'rejected' },
      ORDER,
    ]);
    renderDetail();

    const status = await screen.findByTestId('ticket-status');
    expect(status).toHaveTextContent('Așteaptă plata');
    expect(screen.queryByTestId('buy-ticket-btn')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continuă plata' }));
    expect(await screen.findByTestId('tickets-screen')).toBeInTheDocument();
  });

  it('starea comenzii vine cu pasul următor, scris', async () => {
    vi.mocked(fetchMyTicketOrders).mockResolvedValue([{ ...ORDER, status: 'payment_declared' }]);
    renderDetail();

    expect(await screen.findByTestId('ticket-status')).toHaveTextContent('În verificare');
    expect(screen.getByTestId('ticket-next-step')).toHaveTextContent('Verificăm plata, de obicei în câteva ore');
  });

  it('o comandă respinsă lasă cumpărarea deschisă, dar arată unde e motivul', async () => {
    vi.mocked(fetchMyTicketOrders).mockResolvedValue([{ ...ORDER, id: 'o-resp', status: 'rejected' }]);
    renderDetail();

    const note = await screen.findByTestId('ticket-last-rejected');
    expect(note).toHaveTextContent('Ultima ta comandă pentru acest eveniment a fost respinsă.');
    expect(screen.getByTestId('buy-ticket-btn')).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Vezi motivul' }));
    expect(await screen.findByTestId('tickets-screen')).toHaveTextContent('?order=o-resp');
  });

  it('o comandă aprobată e cea aleasă dintre mai multe și trimite la bilet', async () => {
    vi.mocked(fetchMyTicketOrders).mockResolvedValue([
      ORDER,
      { ...ORDER, id: 'o2', status: 'approved', ticketCode: 'ABC123' },
    ]);
    renderDetail();

    expect(await screen.findByTestId('ticket-status')).toHaveTextContent('Bilet confirmat');
    expect(screen.getByRole('button', { name: 'Vezi biletul' })).toBeInTheDocument();
  });
});

describe('prețul biletului, așa cum îl plătește utilizatorul', () => {
  it('arată prețul redus pe buton și prețul întreg tăiat lângă el', async () => {
    vi.mocked(fetchTicketQuote).mockResolvedValue({
      ...QUOTE,
      loyaltyPercent: 20,
      appliedPercent: 20,
      appliedSource: 'loyalty',
      discountAmount: 30,
      finalPrice: 120,
      tier: { code: 'gold', name: 'Aur', minStamps: 12, discountPercent: 20 },
    });
    renderDetail();

    // Prețul de pe buton e CEL AL OMULUI, nu cel din `Event.ticketPrice`.
    // Butonul apare întâi cu prețul de listă (cotația e încă pe drum) și se
    // corectează când răspunde serverul — de aceea așteptăm textul, nu nodul.
    await waitFor(() =>
      expect(screen.getByTestId('buy-ticket-btn')).toHaveTextContent(
        'Cumpără bilet online — 120 lei',
      ),
    );
    // Reducerea trebuie să se VADĂ: fără prețul întreg tăiat, 120 de lei arată
    // exact ca 120 de lei.
    expect(screen.getByTestId('ticket-quote-base')).toHaveTextContent('150 lei');
    expect(screen.getByTestId('ticket-quote-final')).toHaveTextContent('120 lei');
    expect(screen.getByTestId('ticket-quote-reason')).toHaveTextContent(
      'Preț cu reducerea treptei Aur (−20%).',
    );
  });

  it('fără reducere nu repetă prețul: rămâne doar butonul', async () => {
    vi.mocked(fetchTicketQuote).mockResolvedValue(QUOTE);
    renderDetail();

    expect(await screen.findByTestId('buy-ticket-btn')).toHaveTextContent(
      'Cumpără bilet online — 150 lei',
    );
    expect(screen.queryByTestId('ticket-quote')).not.toBeInTheDocument();
  });

  it('dacă cotația nu se poate aduce, butonul cade pe prețul de listă', async () => {
    vi.mocked(fetchTicketQuote).mockRejectedValue(new Error('offline'));
    renderDetail();

    expect(await screen.findByTestId('buy-ticket-btn')).toHaveTextContent(
      'Cumpără bilet online — 150 lei',
    );
    expect(screen.queryByTestId('ticket-quote')).not.toBeInTheDocument();
  });

  it('un eveniment fără bilet online nu cere nicio cotație', async () => {
    vi.mocked(fetchEvent).mockResolvedValue(BARE_EVENT);
    renderDetail();

    await screen.findByText('Flirt Party Chișinău');
    expect(fetchTicketQuote).not.toHaveBeenCalled();
  });
});

describe('fereastra de vânzare online', () => {
  it('pe un server vechi (fără câmpuri) totul rămâne ca înainte', async () => {
    renderDetail();

    expect(await screen.findByTestId('buy-ticket-btn')).toBeEnabled();
    expect(screen.queryByTestId('ticket-sales-end')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ticket-sales-closed')).not.toBeInTheDocument();
  });

  it('anunță când se închide vânzarea, fără numărătoare cu mai mult de o zi înainte', async () => {
    vi.mocked(fetchEvent).mockResolvedValue({
      ...EVENT,
      ticketSalesEndAt: new Date(Date.now() + 3 * 24 * HOUR).toISOString(),
      ticketSalesOpen: true,
    });
    renderDetail();

    expect(await screen.findByTestId('ticket-sales-end')).toHaveTextContent(
      'Vânzarea online se închide pe',
    );
    expect(screen.queryByTestId('ticket-sales-countdown')).not.toBeInTheDocument();
    expect(screen.getByTestId('buy-ticket-btn')).toBeInTheDocument();
  });

  it('cu mai puțin de 24 h rămase, arată numărătoarea inversă', async () => {
    vi.mocked(fetchEvent).mockResolvedValue({
      ...EVENT,
      ticketSalesEndAt: new Date(Date.now() + 5 * HOUR + 30_000).toISOString(),
      ticketSalesOpen: true,
    });
    renderDetail();

    expect(await screen.findByTestId('ticket-sales-countdown')).toHaveTextContent(
      /Se închide în 05:00:\d{2}/,
    );
  });

  it('închis de server înainte de ora de închidere = bilete epuizate, fără butoane', async () => {
    vi.mocked(fetchEvent).mockResolvedValue({
      ...EVENT,
      ticketSalesEndAt: new Date(Date.now() + 2 * HOUR).toISOString(),
      ticketSalesOpen: false,
    });
    renderDetail();

    expect(await screen.findByTestId('ticket-sales-closed')).toHaveTextContent(
      'Biletele online s-au epuizat',
    );
    expect(screen.queryByTestId('buy-ticket-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('request-ticket-btn')).not.toBeInTheDocument();
  });

  it('ora de închidere trecută închide vânzarea și pe ceasul local', async () => {
    vi.mocked(fetchEvent).mockResolvedValue({
      ...EVENT,
      ticketSalesEndAt: new Date(Date.now() - HOUR).toISOString(),
      ticketSalesOpen: null,
    });
    renderDetail();

    expect(await screen.findByTestId('ticket-sales-closed')).toBeInTheDocument();
    expect(screen.queryByTestId('buy-ticket-btn')).not.toBeInTheDocument();
  });

  it('o comandă activă rămâne vizibilă și după închidere, ca plata să poată fi terminată', async () => {
    vi.mocked(fetchEvent).mockResolvedValue({ ...EVENT, ticketSalesOpen: false });
    vi.mocked(fetchMyTicketOrders).mockResolvedValue([ORDER]);
    renderDetail();

    expect(await screen.findByTestId('ticket-status')).toHaveTextContent('Așteaptă plata');
    expect(screen.queryByTestId('ticket-sales-closed')).not.toBeInTheDocument();
  });

  it.each([
    [409, 'după ora de închidere'],
    [400, 'după începerea evenimentului'],
  ])('refuzul %s `ticket_sales_closed` (%s) arată mesajul și reîncarcă evenimentul', async (status) => {
    vi.mocked(createTicketOrder).mockRejectedValue(codedError(status, 'ticket_sales_closed'));
    renderDetail();

    fireEvent.click(await screen.findByTestId('buy-ticket-btn'));

    expect(await screen.findByTestId('ticket-sales-closed')).toHaveTextContent(
      'Vânzarea online tocmai s-a închis pentru acest eveniment.',
    );
    // Nu și eroarea generică: refuzul are o explicație precisă.
    expect(screen.queryByText('Nu am putut crea comanda. Reîncearcă.')).not.toBeInTheDocument();
    expect(screen.queryByTestId('buy-ticket-btn')).not.toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(fetchEvent).mock.calls.length).toBeGreaterThan(1));
  });

  it('vânzarea oprită global arată mesajul de pauză, fără butoane și fără „epuizat"', async () => {
    vi.mocked(fetchEvent).mockResolvedValue({
      ...EVENT,
      // Aceeași semnătură ca sold-out-ul — pauza trebuie să câștige.
      ticketSalesEndAt: new Date(Date.now() + 2 * HOUR).toISOString(),
      ticketSalesOpen: false,
      ticketSalesPaused: true,
    });
    renderDetail();

    const notice = await screen.findByTestId('ticket-sales-paused');
    expect(notice).toHaveTextContent('Vânzarea online e oprită temporar');
    expect(notice).toHaveTextContent('Poți plăti la intrare.');
    expect(notice).not.toHaveTextContent('epuizat');
    expect(screen.queryByTestId('ticket-sales-closed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('buy-ticket-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('request-ticket-btn')).not.toBeInTheDocument();
  });

  it('cu vânzarea oprită, o comandă existentă rămâne vizibilă și deschisă', async () => {
    vi.mocked(fetchEvent).mockResolvedValue({ ...EVENT, ticketSalesOpen: false, ticketSalesPaused: true });
    vi.mocked(fetchMyTicketOrders).mockResolvedValue([ORDER]);
    renderDetail();

    expect(await screen.findByTestId('ticket-status')).toHaveTextContent('Așteaptă plata');
    expect(screen.queryByTestId('ticket-sales-paused')).not.toBeInTheDocument();
  });

  it('refuzul 409 `online_sales_disabled` arată mesajul de pauză și reîncarcă evenimentul', async () => {
    vi.mocked(createTicketOrder).mockRejectedValue(codedError(409, 'online_sales_disabled'));
    renderDetail();

    fireEvent.click(await screen.findByTestId('buy-ticket-btn'));

    expect(await screen.findByTestId('ticket-sales-paused')).toHaveTextContent('Poți plăti la intrare.');
    expect(screen.queryByText('Nu am putut crea comanda. Reîncearcă.')).not.toBeInTheDocument();
    expect(screen.queryByTestId('buy-ticket-btn')).not.toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(fetchEvent).mock.calls.length).toBeGreaterThan(1));
  });

  it('refuzul „nu mai sunt bilete" (409 fără cod) spune că s-au epuizat, nu „reîncearcă"', async () => {
    vi.mocked(createTicketOrder).mockRejectedValue(
      Object.assign(new Error('409'), { response: { status: 409, data: { detail: 'Nu mai sunt suficiente bilete disponibile.' } } }),
    );
    renderDetail();

    fireEvent.click(await screen.findByTestId('buy-ticket-btn'));

    expect(await screen.findByTestId('ticket-sales-closed')).toHaveTextContent('Biletele online s-au epuizat');
    expect(screen.queryByText('Nu am putut crea comanda. Reîncearcă.')).not.toBeInTheDocument();
    expect(screen.queryByTestId('buy-ticket-btn')).not.toBeInTheDocument();
  });
});
