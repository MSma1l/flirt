import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { UsersPage } from './UsersPage';
import type { AdminUser } from '../api/types';
import { mockFetch, renderWithProviders, seedAdminSession } from '../test/harness';

function user(index: number, overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: `u-${index}`,
    email: `user${index}@flirt.app`,
    role: 'user',
    name: `User ${index}`,
    city: 'București',
    created_at: '2026-06-01T10:00:00Z',
    last_active_at: '2026-07-10T10:00:00Z',
    banned_at: null,
    ban_reason: null,
    profile_completed: true,
    reports_count: 0,
    ...overrides,
  };
}

describe('UsersPage', () => {
  it('listează utilizatorii și paginează server-side prin cursorul din X-Next-Cursor', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/users': (call) => {
        const cursor = new URL(call.url).searchParams.get('cursor');
        if (cursor === 'cursor-2') {
          return { body: [user(3)] };
        }
        return { body: [user(1), user(2)], headers: { 'X-Next-Cursor': 'cursor-2' } };
      },
    });
    const person = userEvent.setup();

    renderWithProviders(<UsersPage />);

    expect(await screen.findByText('user1@flirt.app')).toBeInTheDocument();
    expect(screen.getByText('user2@flirt.app')).toBeInTheDocument();
    expect(screen.getByText('Pagina 1')).toBeInTheDocument();

    await person.click(screen.getByRole('button', { name: 'Înainte' }));

    expect(await screen.findByText('user3@flirt.app')).toBeInTheDocument();
    expect(screen.getByText('Pagina 2')).toBeInTheDocument();
    // Cursorul chiar a fost trimis înapoi serverului.
    expect(
      api.callsTo('GET /admin/users').some((c) => c.url.includes('cursor=cursor-2')),
    ).toBe(true);
    // Ultima pagină: „Înainte" e dezactivat (fără cursor următor).
    expect(screen.getByRole('button', { name: 'Înainte' })).toBeDisabled();
  });

  it('trimite căutarea și filtrul de stare la server', async () => {
    seedAdminSession();
    const api = mockFetch({ 'GET /admin/users': { body: [user(1)] } });
    const person = userEvent.setup();

    renderWithProviders(<UsersPage />);
    await screen.findByText('user1@flirt.app');

    await person.type(screen.getByLabelText('Caută (email sau nume)'), 'ana');
    await person.selectOptions(screen.getByLabelText('Stare'), 'banned');
    await person.click(screen.getByRole('button', { name: 'Caută' }));

    await waitFor(() => {
      expect(
        api.callsTo('GET /admin/users').some((c) => c.url.includes('q=ana') && c.url.includes('status=banned')),
      ).toBe(true);
    });
  });

  it('NU banează fără confirmare, iar motivul e obligatoriu', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/users': { body: [user(1)] },
      'POST /admin/users/u-1/ban': { status: 204 },
      'GET /admin/stats': { body: null },
    });
    const person = userEvent.setup();

    renderWithProviders(<UsersPage />);
    await screen.findByText('user1@flirt.app');

    await person.click(screen.getByRole('button', { name: 'Ban' }));
    const dialog = await screen.findByRole('dialog');
    expect(api.callsTo('POST /admin/users/u-1/ban')).toHaveLength(0);

    // Fără motiv, butonul de confirmare e blocat.
    const confirm = within(dialog).getByRole('button', { name: 'Banează contul' });
    expect(confirm).toBeDisabled();

    await person.type(within(dialog).getByLabelText('Motivul banului'), 'Hărțuire');
    await person.click(within(dialog).getByRole('button', { name: 'Banează contul' }));

    await waitFor(() => {
      expect(api.callsTo('POST /admin/users/u-1/ban')[0]?.body).toEqual({ reason: 'Hărțuire' });
    });
  });

  it('ștergerea GDPR cere confirmare DUBLĂ: tastarea emailului contului', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/users': { body: [user(1)] },
      'DELETE /admin/users/u-1': { status: 204 },
      'GET /admin/stats': { body: null },
    });
    const person = userEvent.setup();

    renderWithProviders(<UsersPage />);
    await screen.findByText('user1@flirt.app');

    await person.click(screen.getByRole('button', { name: 'Șterge' }));
    const dialog = await screen.findByRole('dialog');

    const confirm = within(dialog).getByRole('button', { name: 'Șterge definitiv' });
    expect(confirm).toBeDisabled();

    // Motiv completat, dar fraza NU e tastată → tot blocat.
    await person.type(within(dialog).getByLabelText('Motivul ștergerii'), 'Cerere GDPR');
    expect(within(dialog).getByRole('button', { name: 'Șterge definitiv' })).toBeDisabled();

    // Frază greșită → blocat.
    const phraseField = within(dialog).getByLabelText(/Scrie „user1@flirt\.app"/);
    await person.type(phraseField, 'altceva');
    expect(within(dialog).getByRole('button', { name: 'Șterge definitiv' })).toBeDisabled();
    expect(api.callsTo('DELETE /admin/users/u-1')).toHaveLength(0);

    // Frază corectă → abia acum se poate șterge.
    await person.clear(phraseField);
    await person.type(phraseField, 'user1@flirt.app');
    await person.click(within(dialog).getByRole('button', { name: 'Șterge definitiv' }));

    await waitFor(() => {
      expect(api.callsTo('DELETE /admin/users/u-1')).toHaveLength(1);
    });
  });
});
