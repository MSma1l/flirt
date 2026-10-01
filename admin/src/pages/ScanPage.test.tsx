import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScanPage } from './ScanPage';
import type { AdminEvent, TicketScanResponse } from '../api/types';
import { createQrDecoder } from '../lib/qrDecoder';
import { mockFetch, renderWithProviders, seedAdminSession } from '../test/harness';

// Camera și decodorul nu există în jsdom: le înlocuim cu dubluri controlabile.
vi.mock('../lib/qrDecoder', () => ({ createQrDecoder: vi.fn() }));

const EVENT = {
  id: 'ev-1',
  title: 'Flirt Party Chișinău',
  starts_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  kind: 'flirt_party',
} as AdminEvent;

const PAST_EVENT = {
  id: 'ev-old',
  title: 'Petrecere veche',
  starts_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  kind: 'party',
} as AdminEvent;

const STATS = { event_id: 'ev-1', sold: 10, admitted: 3, flirt_party_admitted: 0 };

const ADMITTED: TicketScanResponse = {
  result: 'admitted',
  ticket: {
    ticket_type: 'event_ticket',
    first_name: 'Ana',
    age: 25,
    photo_url: 'https://cdn.example.com/ana.jpg',
    event_id: 'ev-1',
    event_title: 'Flirt Party Chișinău',
    starts_at: EVENT.starts_at,
    ticket_quantity: 1,
    admitted_at: '2026-10-01T20:15:00Z',
    admitted_by_email: 'staff@flirt.app',
  },
};

function routes(scan: TicketScanResponse | ((body: unknown) => TicketScanResponse)) {
  return {
    'GET /admin/events': { body: [EVENT, PAST_EVENT] },
    'GET /admin/tickets/scan-stats': { body: STATS },
    'GET /admin/events/ev-1/admissions': { body: [] },
    'POST /admin/tickets/scan': (call: { body: unknown }) => ({
      body: typeof scan === 'function' ? scan(call.body) : scan,
    }),
  };
}

describe('ScanPage', () => {
  beforeEach(() => {
    seedAdminSession();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('arată doar evenimentele neîncheiate și contorul live', async () => {
    mockFetch(routes(ADMITTED));
    renderWithProviders(<ScanPage />);

    expect(await screen.findByRole('option', { name: /Flirt Party Chișinău/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Petrecere veche/ })).not.toBeInTheDocument();
    expect(await screen.findByText('3 / 10')).toBeInTheDocument();
  });

  it('codul introdus manual pleacă la API și afișează INTRARE PERMISĂ', async () => {
    const api = mockFetch(routes(ADMITTED));
    const person = userEvent.setup();
    renderWithProviders(<ScanPage />);

    const input = await screen.findByLabelText(/tastează codul/);
    await person.type(input, '3F9A-1C2E');
    await person.click(screen.getByRole('button', { name: 'Verifică' }));

    const card = await screen.findByTestId('scan-result');
    expect(card).toHaveTextContent('INTRARE PERMISĂ');
    expect(card).toHaveTextContent('Ana, 25 ani');
    expect(card).toHaveClass('scan-result--ok');
    expect(api.callsTo('POST /admin/tickets/scan')).toHaveLength(1);
    expect(api.callsTo('POST /admin/tickets/scan')[0]?.body).toEqual({
      code: '3F9A-1C2E',
      event_id: 'ev-1',
    });

    // O atingere oriunde închide cardul și revine la scanare.
    await person.click(card);
    expect(screen.queryByTestId('scan-result')).not.toBeInTheDocument();
  });

  it.each<[TicketScanResponse, string, string]>([
    [
      { result: 'already_admitted', ticket: ADMITTED.ticket },
      'DEJA INTRAT',
      'scanat de staff@flirt.app',
    ],
    [
      { result: 'wrong_event', ticket: { ...ADMITTED.ticket!, event_title: 'Concert X', admitted_at: null } },
      'ALT EVENIMENT',
      'Concert X',
    ],
    [{ result: 'not_paid', ticket: ADMITTED.ticket }, 'NEPLĂTIT', 'Plata nu a fost confirmată'],
    [{ result: 'cancelled', ticket: ADMITTED.ticket }, 'BILET ANULAT', 'respinsă sau anulată'],
    [{ result: 'event_over', ticket: ADMITTED.ticket }, 'EVENIMENT ÎNCHEIAT', 's-a terminat'],
    [{ result: 'not_found', ticket: null }, 'BILET NEGĂSIT', 'niciunui bilet'],
  ])('refuz %#: card roșu cu motivul', async (response, title, reason) => {
    mockFetch(routes(response));
    const person = userEvent.setup();
    renderWithProviders(<ScanPage />);

    await person.type(await screen.findByLabelText(/tastează codul/), 'abcdef12');
    await person.click(screen.getByRole('button', { name: 'Verifică' }));

    const card = await screen.findByTestId('scan-result');
    expect(card).toHaveClass('scan-result--fail');
    expect(card).toHaveTextContent(title);
    expect(card).toHaveTextContent(reason);
  });

  it('permisiunea de cameră refuzată → instrucțiuni clare', async () => {
    mockFetch(routes(ADMITTED));
    vi.stubGlobal('isSecureContext', true);
    const getUserMedia = vi
      .fn()
      .mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    const person = userEvent.setup();
    renderWithProviders(<ScanPage />);

    await person.click(await screen.findByRole('button', { name: 'Pornește camera' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Accesul la cameră a fost refuzat');
    expect(alert).toHaveTextContent('Setări');
    expect(getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({ facingMode: { ideal: 'environment' } }),
      }),
    );
  });

  it('pe HTTP (context nesigur) explică de ce camera nu pornește', async () => {
    mockFetch(routes(ADMITTED));
    vi.stubGlobal('isSecureContext', false);
    const person = userEvent.setup();
    renderWithProviders(<ScanPage />);

    await person.click(await screen.findByRole('button', { name: 'Pornește camera' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTPS');
  });

  it('camera: QR citit continuu → o singură cerere (pauză + cooldown)', async () => {
    const api = mockFetch(routes(ADMITTED));
    vi.stubGlobal('isSecureContext', true);
    const track = {
      stop: vi.fn(),
      getCapabilities: () => ({ torch: true }),
      applyConstraints: vi.fn().mockResolvedValue(undefined),
    };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4);
    const decode = vi.fn().mockResolvedValue('3f9a1c2e3f9a1c2e3f9a1c2e3f9a1c2e');
    vi.mocked(createQrDecoder).mockResolvedValue({ decode });
    const person = userEvent.setup();
    renderWithProviders(<ScanPage />);

    await person.click(await screen.findByRole('button', { name: 'Pornește camera' }));
    expect(await screen.findByTestId('scan-result')).toHaveTextContent('INTRARE PERMISĂ');
    // Decodorul continuă să vadă același QR, dar nu pleacă o a doua cerere.
    await waitFor(() => expect(decode.mock.calls.length).toBeGreaterThan(2));
    expect(api.callsTo('POST /admin/tickets/scan')).toHaveLength(1);
    // Lanterna e oferită doar când camera o suportă.
    expect(screen.getByRole('button', { name: 'Lanterna' })).toBeInTheDocument();
  });
});
