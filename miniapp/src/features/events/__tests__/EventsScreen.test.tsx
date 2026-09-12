/**
 * Lista de evenimente: stări oneste și legături corecte către detaliu.
 *
 * Stratul de rețea e mockat la nivelul modulului LOCAL `../eventsApi` (cel care
 * re-exportă funcțiile pure din aplicația Expo), nu la nivelul lui axios:
 * testele trebuie să verifice DECIZIILE ecranului, nu transportul HTTP.
 */
import { fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EventItem } from '@mobile/features/events/types';

import { renderWithProviders } from '@/test/harness';

import { EventsScreen } from '../EventsScreen';
import { eventPath } from '../eventRoutes';

vi.mock('../eventsApi', () => ({
  fetchEvents: vi.fn(),
  fetchEvent: vi.fn(),
  setGoing: vi.fn(),
  checkin: vi.fn(),
  fetchMyTicketOrders: vi.fn(),
  createTicketOrder: vi.fn(),
}));

const { fetchEvents } = await import('../eventsApi');

const EVENTS: EventItem[] = [
  {
    id: 'e1',
    title: 'Flirt Party Chișinău',
    description: 'Seară de cunoștințe.',
    startsAt: '2026-07-04T19:00:00.000Z',
    city: 'Chișinău',
    venue: 'Club Mono',
    lat: 47.0245,
    lng: 28.8322,
    kind: 'flirt_party',
    attendeeCount: 42,
    iAmGoing: true,
    promoDiscountPercent: null,
    promoCode: null,
    promoDescription: null,
    ticketPrice: null,
    ticketCurrency: null,
  },
  {
    id: 'e2',
    title: 'Concert în parc',
    description: '',
    startsAt: '2026-08-10T18:30:00.000Z',
    city: 'Bălți',
    venue: 'Parcul Central',
    kind: 'concert',
    attendeeCount: 7,
    iAmGoing: false,
    promoDiscountPercent: null,
    promoCode: null,
    promoDescription: null,
    ticketPrice: null,
    ticketCurrency: null,
  },
];

function renderList() {
  return renderWithProviders(
    <MemoryRouter>
      <EventsScreen />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(fetchEvents).mockResolvedValue(EVENTS);
});

describe('randarea listei', () => {
  it('arată un indicator cât timp datele nu au sosit', () => {
    // Promisiune care nu se rezolvă: ecranul rămâne în starea de încărcare.
    vi.mocked(fetchEvents).mockReturnValue(new Promise<EventItem[]>(() => {}));
    renderList();

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('arată titlul, data, locul, participanții și indicatorul „Mergi"', async () => {
    renderList();

    expect(await screen.findByText('Flirt Party Chișinău')).toBeInTheDocument();
    expect(screen.getByText('Concert în parc')).toBeInTheDocument();

    expect(screen.getByText('Club Mono · Chișinău')).toBeInTheDocument();
    expect(screen.getByText('42 participanți')).toBeInTheDocument();
    expect(screen.getByText('7 participanți')).toBeInTheDocument();

    // Badge-ul de tip vine din `kindLabel`, nu din datele brute.
    expect(screen.getByText('Flirt Party')).toBeInTheDocument();
    expect(screen.getByText('Concert')).toBeInTheDocument();

    // Doar evenimentul la care utilizatorul merge poartă indicatorul.
    expect(screen.getAllByText('Mergi')).toHaveLength(1);
  });

  it('fiecare card e un link către detaliul lui, iar antetul duce la Flirt Passport', async () => {
    renderList();

    await screen.findByText('Flirt Party Chișinău');

    expect(screen.getByRole('link', { name: 'Deschide Flirt Party Chișinău' })).toHaveAttribute(
      'href',
      eventPath('e1'),
    );
    expect(screen.getByRole('link', { name: 'Deschide Concert în parc' })).toHaveAttribute(
      'href',
      eventPath('e2'),
    );
    expect(screen.getByRole('link', { name: 'Flirt Passport ›' })).toHaveAttribute(
      'href',
      '/passport',
    );
  });
});

describe('stări oneste', () => {
  it('lista goală are un text explicativ, nu un ecran alb', async () => {
    vi.mocked(fetchEvents).mockResolvedValue([]);
    renderList();

    expect(await screen.findByTestId('events-empty')).toHaveTextContent(
      'Niciun eveniment momentan',
    );
  });

  it('eroarea de rețea se anunță și se poate reîncerca cu succes', async () => {
    vi.mocked(fetchEvents).mockRejectedValueOnce(new Error('offline'));
    renderList();

    expect(await screen.findByTestId('events-error')).toHaveTextContent(
      'Nu am putut încărca evenimentele.',
    );

    vi.mocked(fetchEvents).mockResolvedValue(EVENTS);
    fireEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }));

    expect(await screen.findByText('Flirt Party Chișinău')).toBeInTheDocument();
    expect(screen.queryByTestId('events-error')).not.toBeInTheDocument();
  });

  it('o reîncercare eșuată lasă mesajul de eroare pe ecran, nu un ecran gol', async () => {
    vi.mocked(fetchEvents).mockRejectedValue(new Error('offline'));
    renderList();

    const error = await screen.findByTestId('events-error');
    fireEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }));

    expect(await screen.findByTestId('events-error')).toBe(error);
    expect(screen.queryByTestId('events-empty')).not.toBeInTheDocument();
  });
});
