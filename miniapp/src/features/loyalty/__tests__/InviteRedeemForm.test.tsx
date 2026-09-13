/**
 * Folosirea unui cod de invitație: normalizarea a ce tastează omul și un mesaj
 * DISTINCT pentru fiecare răspuns al backendului.
 *
 * Fiecare caz din `backend/app/services/loyalty.py::redeem_invite` are aici
 * testul lui. Dacă două cazuri ajung să arate la fel pe ecran, testul cade —
 * exact scopul lui: „ceva n-a mers" nu îi spune omului dacă să mai încerce, să
 * scrie organizatorului sau să mai meargă la un eveniment.
 */
import { AxiosError, type AxiosResponse } from 'axios';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/harness';

import { InviteRedeemForm } from '../InviteRedeemForm';
import type { InviteRedemption } from '../loyaltyApi';

vi.mock('../loyaltyApi', () => ({
  redeemInvite: vi.fn(),
  fetchLoyaltyStatus: vi.fn(),
  fetchTicketQuote: vi.fn(),
}));

const { redeemInvite } = await import('../loyaltyApi');

const REDEEMED: InviteRedemption = {
  inviteId: 'i1',
  eventId: 'e1',
  eventTitle: 'Flirt Party Chișinău',
  eventStartsAt: '2026-05-01T20:00:00Z',
  discountPercent: 30,
  redeemedAt: '2026-04-01T10:00:00Z',
  consumedNewUse: true,
};

function httpError(status: number, detail?: string): AxiosError {
  const response = {
    status,
    statusText: '',
    headers: {},
    config: {} as never,
    data: detail === undefined ? {} : { detail },
  } as AxiosResponse;
  return new AxiosError('failed', 'ERR_BAD_RESPONSE', undefined, null, response);
}

function type(value: string) {
  fireEvent.change(screen.getByTestId('invite-input'), { target: { value } });
}

function submit() {
  fireEvent.click(screen.getByTestId('invite-submit'));
}

beforeEach(() => {
  vi.mocked(redeemInvite).mockResolvedValue(REDEEMED);
});

describe('normalizarea codului', () => {
  it('câmpul arată majuscule, fără spații și fără cratime, pe măsură ce se tastează', () => {
    renderWithProviders(<InviteRedeemForm />);
    type(' abcd-23 45 ');

    expect(screen.getByTestId('invite-input')).toHaveValue('ABCD2345');
  });

  it('spre server pleacă forma canonică, nu ce a tastat omul', async () => {
    renderWithProviders(<InviteRedeemForm />);
    type('abcd-2345');
    submit();

    await waitFor(() => expect(redeemInvite).toHaveBeenCalledWith('ABCD2345'));
  });

  it('un câmp gol nu trimite nicio cerere: ar fi una sigur respinsă', () => {
    renderWithProviders(<InviteRedeemForm />);

    expect(screen.getByTestId('invite-submit')).toBeDisabled();
    type('   ');
    expect(screen.getByTestId('invite-submit')).toBeDisabled();
    submit();
    expect(redeemInvite).not.toHaveBeenCalled();
  });
});

describe('reușita', () => {
  it('spune ce a primit și pentru ce eveniment', async () => {
    renderWithProviders(<InviteRedeemForm />);
    type('abcd2345');
    submit();

    expect(await screen.findByTestId('invite-success')).toHaveTextContent(
      'Gata! Ai −30% la „Flirt Party Chișinău”.',
    );
    // Câmpul se golește: codul e consumat, nu are rost să mai stea acolo.
    expect(screen.getByTestId('invite-input')).toHaveValue('');
  });

  it('o invitație fără reducere nu inventează „−0%"', async () => {
    vi.mocked(redeemInvite).mockResolvedValue({ ...REDEEMED, discountPercent: 0 });
    renderWithProviders(<InviteRedeemForm />);
    type('abcd2345');
    submit();

    const message = await screen.findByTestId('invite-success');
    expect(message).toHaveTextContent('Invitația ta la „Flirt Party Chișinău” este activă.');
    expect(message).not.toHaveTextContent('0%');
  });

  it('„o ai deja" nu e eroare, dar nici felicitare', async () => {
    vi.mocked(redeemInvite).mockResolvedValue({ ...REDEEMED, consumedNewUse: false });
    renderWithProviders(<InviteRedeemForm />);
    type('abcd2345');
    submit();

    expect(await screen.findByTestId('invite-success')).toHaveTextContent(
      'Ai deja invitația la „Flirt Party Chișinău” (−30%).',
    );
    expect(screen.queryByTestId('invite-error')).not.toBeInTheDocument();
  });
});

describe('fiecare eșec al backendului are textul lui', () => {
  it.each([
    [
      httpError(404, 'Cod de invitație invalid.'),
      'Codul acesta nu există. Verifică literele și cifrele, apoi încearcă din nou.',
    ],
    [httpError(409, 'Invitația a expirat.'), 'Invitația a ieșit din termen.'],
    [
      httpError(409, 'Invitația a fost deja folosită de numărul maxim de persoane.'),
      'Invitația a fost deja folosită de toate persoanele pentru care era valabilă.',
    ],
    [httpError(409, 'Invitația a fost anulată.'), 'Organizatorul a retras această invitație.'],
    [httpError(409, 'altceva'), 'Invitația nu mai poate fi folosită.'],
    [
      httpError(403, 'Invitația cere cel puțin 5 ștampile Flirt Passport.'),
      'Invitația cere cel puțin 5 ștampile Flirt Passport.',
    ],
    [httpError(403, 'prea puține'), 'Invitația cere mai multe ștampile Flirt Passport decât ai acum.'],
    [httpError(429), 'Prea multe încercări. Așteaptă un minut și încearcă din nou.'],
    [new AxiosError('offline', 'ERR_NETWORK'), 'Nu ai conexiune. Codul nu a plecat'],
    [httpError(500), 'Serverul nu a răspuns.'],
    [new Error('boom'), 'Nu am putut folosi codul.'],
  ])('cazul %#', async (error, expected) => {
    vi.mocked(redeemInvite).mockRejectedValueOnce(error);
    renderWithProviders(<InviteRedeemForm />);
    type('abcd2345');
    submit();

    expect(await screen.findByTestId('invite-error')).toHaveTextContent(expected);
  });

  it('pragul cerut se scrie la singular când e o singură ștampilă', async () => {
    vi.mocked(redeemInvite).mockRejectedValueOnce(
      httpError(403, 'Invitația cere cel puțin 1 ștampile Flirt Passport.'),
    );
    renderWithProviders(<InviteRedeemForm />);
    type('abcd2345');
    submit();

    expect(await screen.findByTestId('invite-error')).toHaveTextContent(
      'Invitația cere cel puțin 1 ștampilă Flirt Passport.',
    );
  });

  it('niciun eșec nu deschide `alert()` sau `confirm()` — ar bloca WebView-ul Telegram', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true);

    vi.mocked(redeemInvite).mockRejectedValueOnce(httpError(404));
    renderWithProviders(<InviteRedeemForm />);
    type('abcd2345');
    submit();

    await screen.findByTestId('invite-error');
    expect(alertSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('un eșec nu lasă pe ecran mesajul de reușită de dinainte', async () => {
    renderWithProviders(<InviteRedeemForm />);
    type('abcd2345');
    submit();
    await screen.findByTestId('invite-success');

    vi.mocked(redeemInvite).mockRejectedValueOnce(httpError(404));
    type('wxyz9876');
    submit();

    await screen.findByTestId('invite-error');
    expect(screen.queryByTestId('invite-success')).not.toBeInTheDocument();
  });
});
