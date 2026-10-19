/**
 * Testul de umor din panou: starea clară (activ / inactiv), comutatorul,
 * glumele (adăugare, reordonare, ștergere) și textul de introducere.
 *
 * O validare „care blochează" se dovedește prin absența cererii, nu prin
 * prezența unui mesaj.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { HumorPage } from './HumorPage';
import type { HumorQuestion, HumorSettings } from '../api/humor';
import { mockFetch, renderWithProviders, seedAdminSession } from '../test/harness';

const SETTINGS: HumorSettings = {
  enabled: false,
  intro_ro: 'De ce facem testul.',
  intro_ru: 'Зачем тест.',
  intro_en: 'Why the test.',
  active_questions: 3,
  min_active_questions: 3,
  humor_types: ['sarcasm', 'dark', 'absurd'],
  updated_at: null,
};

function question(id: string, position: number, overrides: Partial<HumorQuestion> = {}) {
  return {
    id,
    key: `c${position + 1}`,
    humor_type: 'sarcasm',
    text_ro: `Gluma ${position + 1}`,
    text_ru: `Шутка ${position + 1}`,
    text_en: `Joke ${position + 1}`,
    position,
    active: true,
    updated_at: null,
    ...overrides,
  } satisfies HumorQuestion;
}

const QUESTIONS = [question('a', 0), question('b', 1), question('c', 2)];

const GET_SETTINGS = 'GET /admin/humor/settings';
const PUT_SETTINGS = 'PUT /admin/humor/settings';
const GET_QUESTIONS = 'GET /admin/humor/questions';

async function renderPage(routes: Parameters<typeof mockFetch>[0] = {}) {
  seedAdminSession();
  const api = mockFetch({
    [GET_SETTINGS]: { body: SETTINGS },
    [GET_QUESTIONS]: { body: QUESTIONS },
    ...routes,
  });
  const person = userEvent.setup();
  renderWithProviders(<HumorPage />);
  // Două încărcări înlănțuite (setări, apoi glume): timp mai larg decât 1s.
  await screen.findByText('Gluma 1', {}, { timeout: 10_000 });
  return { api, person };
}

describe('HumorPage — starea testului', () => {
  it('arată clar că testul e INACTIV și ce înseamnă asta', async () => {
    await renderPage();

    expect(screen.getByTestId('humor-status')).toHaveTextContent('INACTIV');
    expect(screen.getByRole('switch', { name: 'Test de umor activ' })).not.toBeChecked();
    expect(screen.getByText(/Nimeni nu e obligat să dea testul/)).toBeInTheDocument();
  });

  it('comutatorul pornește testul și păstrează textul de introducere', async () => {
    const { api, person } = await renderPage({
      [PUT_SETTINGS]: { body: { ...SETTINGS, enabled: true } },
    });

    await person.click(screen.getByRole('switch', { name: 'Test de umor activ' }));

    await waitFor(() => expect(api.callsTo(PUT_SETTINGS)).toHaveLength(1));
    expect(api.callsTo(PUT_SETTINGS)[0]?.body).toEqual({
      enabled: true,
      intro_ro: 'De ce facem testul.',
      intro_ru: 'Зачем тест.',
      intro_en: 'Why the test.',
    });
    await waitFor(() => expect(screen.getByTestId('humor-status')).toHaveTextContent('ACTIV'));
  });

  it('sub minimul de glume active testul nu poate fi pornit', async () => {
    seedAdminSession();
    const api = mockFetch({
      [GET_SETTINGS]: { body: { ...SETTINGS, active_questions: 2 } },
      [GET_QUESTIONS]: { body: QUESTIONS },
    });
    renderWithProviders(<HumorPage />);

    const toggle = await screen.findByRole('switch', { name: 'Test de umor activ' });
    expect(toggle).toBeDisabled();
    expect(screen.getByText('Activează cel puțin 3 glume ca să poți porni testul.')).toBeInTheDocument();
    expect(api.callsTo(PUT_SETTINGS)).toHaveLength(0);
  });
});

describe('HumorPage — glumele', () => {
  it('nu trimite o glumă fără text în toate cele 3 limbi', async () => {
    const { api, person } = await renderPage({
      'POST /admin/humor/questions': { status: 201, body: question('d', 3) },
    });

    await person.click(screen.getByRole('button', { name: 'Adaugă glumă' }));
    const dialog = await screen.findByRole('dialog');
    await person.type(within(dialog).getByLabelText('Textul glumei RO'), 'Gluma nouă');
    await person.type(within(dialog).getByLabelText('Textul glumei RU'), 'Новая');

    const save = within(dialog).getByRole('button', { name: 'Salvează' });
    expect(save).toBeDisabled();
    expect(api.callsTo('POST /admin/humor/questions')).toHaveLength(0);

    await person.type(within(dialog).getByLabelText('Textul glumei EN'), '  New joke  ');
    await person.selectOptions(within(dialog).getByLabelText('Tipul de umor măsurat'), 'absurd');
    await person.click(save);

    await waitFor(() => expect(api.callsTo('POST /admin/humor/questions')).toHaveLength(1));
    expect(api.callsTo('POST /admin/humor/questions')[0]?.body).toEqual({
      humor_type: 'absurd',
      text_ro: 'Gluma nouă',
      text_ru: 'Новая',
      text_en: 'New joke',
      active: true,
    });
  });

  it('„mută mai jos" trimite noua ordine completă', async () => {
    const { api, person } = await renderPage({
      'PUT /admin/humor/questions/order': { body: [QUESTIONS[1], QUESTIONS[0], QUESTIONS[2]] },
    });

    const first = screen.getAllByTestId('humor-question')[0];
    expect(first).toBeDefined();
    await person.click(within(first as HTMLElement).getByRole('button', { name: 'Mută mai jos' }));

    await waitFor(() => expect(api.callsTo('PUT /admin/humor/questions/order')).toHaveLength(1));
    expect(api.callsTo('PUT /admin/humor/questions/order')[0]?.body).toEqual({
      ids: ['b', 'a', 'c'],
    });
  });

  it('ștergerea cere confirmare, apoi trimite DELETE', async () => {
    const { api, person } = await renderPage({
      'DELETE /admin/humor/questions/c': { status: 204 },
    });

    const last = screen.getAllByTestId('humor-question')[2];
    await person.click(within(last as HTMLElement).getByRole('button', { name: 'Șterge' }));
    expect(api.callsTo('DELETE /admin/humor/questions/c')).toHaveLength(0);

    const dialog = await screen.findByRole('dialog');
    await person.click(within(dialog).getByRole('button', { name: 'Șterge gluma' }));

    await waitFor(() => expect(api.callsTo('DELETE /admin/humor/questions/c')).toHaveLength(1));
  });
});

describe('HumorPage — ecranul de introducere', () => {
  it('salvează textul editat, fără să schimbe starea testului', async () => {
    const { api, person } = await renderPage({
      [PUT_SETTINGS]: { body: { ...SETTINGS, intro_en: 'Why we ask.' } },
    });

    const en = screen.getByLabelText('Text EN');
    await person.clear(en);
    await person.type(en, 'Why we ask.');
    await person.click(screen.getByRole('button', { name: 'Salvează textul' }));

    await waitFor(() => expect(api.callsTo(PUT_SETTINGS)).toHaveLength(1));
    expect(api.callsTo(PUT_SETTINGS)[0]?.body).toMatchObject({
      enabled: false,
      intro_en: 'Why we ask.',
    });
    expect(
      await screen.findByText('Textul a fost salvat. Se vede imediat în aplicație.'),
    ).toBeInTheDocument();
  });
});
