/**
 * Tipurile de bilet (până la 4 prețuri): modelul pur și alegerea pe pagina
 * evenimentului. Cu un singur tip fluxul rămâne cel vechi (fără pas în plus);
 * cu mai multe, omul alege un card, iar cotația și comanda poartă tipul ales.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TICKETS_PATH } from '@/features/tickets/ticketRoutes';
import { TICKET_REQUEST_ROUTE_PATTERN } from '@/features/ticketRequests/ticketRequestRoutes';
import { renderWithProviders } from '@/test/harness';

import { EventScreen } from '../EventScreen';
import { EVENT_ROUTE_PATTERN } from '../eventRoutes';
import type { EventItem } from '../eventsApi';
import { lowestTierPrice, mapTicketTiers, needsTierChoice, resolveTier, type TicketTier } from '../ticketTiers';

vi.mock('../eventsApi', () => ({
  fetchEvents: vi.fn(),
  fetchEvent: vi.fn(),
  setGoing: vi.fn(),
  checkin: vi.fn(),
  fetchMyTicketOrders: vi.fn(),
  createTicketOrder: vi.fn(),
}));

vi.mock('@/features/loyalty/loyaltyApi', () => ({
  fetchTicketQuote: vi.fn(),
  fetchLoyaltyStatus: vi.fn(),
  redeemInvite: vi.fn(),
}));

vi.mock('leaflet', () => {
  const layer = { addTo: vi.fn(() => layer), bindPopup: vi.fn(() => layer) };
  return {
    map: vi.fn(() => ({ remove: vi.fn() })),
    tileLayer: vi.fn(() => layer),
    circleMarker: vi.fn(() => layer),
  };
});

const { createTicketOrder, fetchEvent, fetchMyTicketOrders } = await import('../eventsApi');
const { fetchTicketQuote } = await import('@/features/loyalty/loyaltyApi');

const TIERS: TicketTier[] = [
  { id: 't-early', name: 'Early bird', description: 'Primele bilete', price: 100, soldOut: true },
  { id: 't-std', name: 'Standard', description: null, price: 150, soldOut: false },
  { id: 't-vip', name: 'VIP', description: 'Acces lounge', price: 300, soldOut: false },
];

const EVENT: EventItem = {
  id: 'e1',
  title: 'Flirt Party Chișinău',
  description: '',
  startsAt: '2027-07-04T19:00:00.000Z',
  city: 'Chișinău',
  venue: 'Club Mono',
  kind: 'flirt_party',
  attendeeCount: 0,
  iAmGoing: false,
  promoDiscountPercent: null,
  promoCode: null,
  promoDescription: null,
  ticketPrice: 100,
  ticketCurrency: 'lei',
  ticketTiers: TIERS,
};

function Probe({ testId }: { testId: string }) {
  const location = useLocation();
  return <div data-testid={testId}>{location.pathname + location.search}</div>;
}

function renderDetail() {
  return renderWithProviders(
    <MemoryRouter initialEntries={['/events/e1']}>
      <Routes>
        <Route path={EVENT_ROUTE_PATTERN} element={<EventScreen />} />
        <Route path={TICKETS_PATH} element={<Probe testId="tickets-screen" />} />
        <Route path={TICKET_REQUEST_ROUTE_PATTERN} element={<Probe testId="request-screen" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(fetchEvent).mockResolvedValue(EVENT);
  vi.mocked(fetchMyTicketOrders).mockResolvedValue([]);
  vi.mocked(fetchTicketQuote).mockRejectedValue(new Error('no quote'));
  vi.mocked(createTicketOrder).mockResolvedValue({
    order: { id: 'o1', eventId: 'e1', status: 'awaiting_payment', price: 300, currency: 'lei', ticketCode: null },
    payment: null,
  });
});

describe('modelul tipurilor de bilet', () => {
  it('mapează răspunsul serverului tolerant la lipsă', () => {
    expect(mapTicketTiers(undefined)).toEqual([]);
    expect(
      mapTicketTiers([
        { id: 'a', name: 'VIP', description: '', price: 300, sold_out: true },
        { name: 'fără id' },
      ]),
    ).toEqual([{ id: 'a', name: 'VIP', description: null, price: 300, soldOut: true }]);
  });

  it('preselectează primul tip disponibil și respectă alegerea validă', () => {
    expect(resolveTier(TIERS, null)?.id).toBe('t-std');
    expect(resolveTier(TIERS, 't-vip')?.id).toBe('t-vip');
    // Un tip epuizat nu poate rămâne ales.
    expect(resolveTier(TIERS, 't-early')?.id).toBe('t-std');
    expect(resolveTier([], null)).toBeNull();
    expect(needsTierChoice(TIERS)).toBe(true);
    expect(needsTierChoice([TIERS[1]!])).toBe(false);
    expect(lowestTierPrice(TIERS)).toBe(150);
  });
});

describe('alegerea tipului pe pagina evenimentului', () => {
  it('arată cardurile, marchează epuizatul și comandă tipul ales', async () => {
    renderDetail();

    expect(await screen.findByTestId('ticket-tier-picker')).toBeInTheDocument();
    const early = screen.getByTestId('ticket-tier-t-early');
    expect(early).toHaveTextContent('Epuizat');
    expect(early.querySelector('input')).toBeDisabled();

    const buy = screen.getByTestId('buy-ticket-btn');
    expect(buy).toHaveTextContent('150 lei');

    fireEvent.click(screen.getByTestId('ticket-tier-t-vip').querySelector('input')!);
    await waitFor(() => expect(screen.getByTestId('buy-ticket-btn')).toHaveTextContent('300 lei'));
    // Cotația se cere pentru tipul ales.
    await waitFor(() => expect(fetchTicketQuote).toHaveBeenCalledWith('e1', 't-vip'));

    fireEvent.click(screen.getByTestId('buy-ticket-btn'));
    await waitFor(() => expect(createTicketOrder).toHaveBeenCalledWith('e1', 't-vip'));
    expect(await screen.findByTestId('tickets-screen')).toHaveTextContent('?order=o1');
  });

  it('cererea manuală primește tipul ales în URL', async () => {
    renderDetail();
    fireEvent.click((await screen.findByTestId('ticket-tier-t-vip')).querySelector('input')!);
    fireEvent.click(screen.getByTestId('request-ticket-btn'));
    expect(await screen.findByTestId('request-screen')).toHaveTextContent('?tier=t-vip');
  });

  it('cu un singur tip nu există pas de alegere, iar comanda pleacă fără tip', async () => {
    vi.mocked(fetchEvent).mockResolvedValue({ ...EVENT, ticketPrice: 150, ticketTiers: [TIERS[1]!] });
    renderDetail();

    const buy = await screen.findByTestId('buy-ticket-btn');
    expect(screen.queryByTestId('ticket-tier-picker')).not.toBeInTheDocument();
    fireEvent.click(buy);
    await waitFor(() => expect(createTicketOrder).toHaveBeenCalledWith('e1'));
  });
});
