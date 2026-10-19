/**
 * Testul de umor: comutatorul din panou, ecranul de introducere, parcurgerea
 * quiz-ului, salvarea, și stările în care userul NU trebuie lăsat într-o
 * fundătură (rețea căzută, quiz gol, salvare eșuată).
 *
 * Stratul de rețea e izolat la nivelul modulului propriu `humorApi` (care
 * re-exportă funcțiile reutilizate din aplicația Expo), ca testele să verifice
 * DECIZIILE ecranului, nu axios.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HumorCard } from '@mobile/features/humor/types';

import i18n from '@/i18n';
import { createTestQueryClient, renderWithProviders } from '@/test/harness';

import { HumorScreen, HUMOR_ME_QUERY_KEY } from '../HumorScreen';
import type { HumorConfig } from '../humorApi';

vi.mock('../humorApi', () => ({
  HUMOR_CONFIG_QUERY_KEY: ['humor-config'],
  fetchHumorConfig: vi.fn(),
  fetchQuiz: vi.fn(),
  submitQuiz: vi.fn(),
  fetchHumor: vi.fn(),
}));

const { fetchHumorConfig, fetchQuiz, submitQuiz } = await import('../humorApi');

const CARDS: HumorCard[] = [
  {
    id: 'c1',
    type: 'absurd',
    text_ro: 'Gluma unu',
    text_ru: 'Шутка один',
    text_en: 'Joke one',
  },
  {
    id: 'c2',
    type: 'dark',
    text_ro: 'Gluma doi',
    text_ru: 'Шутка два',
    text_en: 'Joke two',
  },
];

const CONFIG_ON: HumorConfig = {
  enabled: true,
  intro_ro: 'Ca să te potrivim după umor.\n\nDurează un minut.',
  intro_ru: 'Чтобы подобрать по юмору.',
  intro_en: '',
  question_count: 2,
};

function renderScreen() {
  return renderWithProviders(
    <MemoryRouter>
      <HumorScreen />
    </MemoryRouter>,
  );
}

/** Trece de ecranul de introducere (primul ecran când testul e pornit). */
async function start() {
  fireEvent.click(await screen.findByTestId('humor-start'));
}

beforeEach(() => {
  vi.mocked(fetchHumorConfig).mockResolvedValue(CONFIG_ON);
  vi.mocked(fetchQuiz).mockResolvedValue(CARDS);
  vi.mocked(submitQuiz).mockResolvedValue({ vector: { absurd: 1 } });
});

afterEach(async () => {
  vi.mocked(fetchQuiz).mockClear();
  // Limba e stare GLOBALĂ a instanței i18n: un test care o schimbă ar molipsi
  // toate testele de după el.
  if (i18n.language !== 'ro') {
    await act(async () => {
      await i18n.changeLanguage('ro');
    });
  }
});

describe('comutatorul din panou', () => {
  it('testul OPRIT nu cere glumele și spune că nu e nimic de făcut', async () => {
    vi.mocked(fetchHumorConfig).mockResolvedValue({ ...CONFIG_ON, enabled: false });
    renderScreen();

    // Primul test din fișier plătește încălzirea (i18n, React Query): timp mai larg.
    expect(await screen.findByTestId('humor-disabled', {}, { timeout: 10_000 })).toHaveTextContent(
      'Testul de umor nu e disponibil acum',
    );
    expect(fetchQuiz).not.toHaveBeenCalled();
    expect(screen.queryByTestId('humor-start')).not.toBeInTheDocument();
  });

  it('starea testului care nu se încarcă se poate reîncerca', async () => {
    vi.mocked(fetchHumorConfig).mockRejectedValueOnce(new Error('offline'));
    renderScreen();

    fireEvent.click(await screen.findByTestId('humor-load-retry'));
    expect(await screen.findByTestId('humor-intro')).toBeInTheDocument();
  });
});

describe('ecranul de introducere', () => {
  it('explică DE CE se face testul înainte de prima glumă, cu textul din panou', async () => {
    renderScreen();

    expect(await screen.findByTestId('humor-intro')).toBeInTheDocument();
    expect(screen.getByText('De ce un test de umor?')).toBeInTheDocument();
    const text = screen.getByTestId('humor-intro-text');
    expect(text).toHaveTextContent('Ca să te potrivim după umor.');
    // Paragrafele din panou rămân paragrafe.
    expect(text.querySelectorAll('p')).toHaveLength(2);
    expect(screen.getByText('Durează 1–2 minute.')).toBeInTheDocument();
    expect(screen.queryByTestId('humor-card-text')).not.toBeInTheDocument();

    await start();
    expect(await screen.findByTestId('humor-card-text')).toHaveTextContent('Gluma unu');
  });

  it('textul gol din panou cade pe explicația implicită din catalog', async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    vi.mocked(fetchHumorConfig).mockResolvedValue({ ...CONFIG_ON, intro_ro: '', intro_en: '' });
    renderScreen();

    expect(await screen.findByTestId('humor-intro-text')).toHaveTextContent(
      'show you more people whose humor clicks with yours',
    );
  });
});

describe('stări de încărcare și date lipsă', () => {
  it('arată un indicator cât timp quiz-ul se încarcă', async () => {
    vi.mocked(fetchQuiz).mockReturnValue(new Promise<HumorCard[]>(() => {}));
    renderScreen();
    await start();

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('humor-card-text')).not.toBeInTheDocument();
  });

  it('quiz-ul gol are un text explicativ, nu un ecran alb', async () => {
    vi.mocked(fetchQuiz).mockResolvedValue([]);
    renderScreen();
    await start();

    expect(await screen.findByTestId('humor-empty')).toHaveTextContent(
      'Nu există glume disponibile deocamdată.',
    );
  });

  it('eroarea de rețea se anunță și se poate reîncerca', async () => {
    vi.mocked(fetchQuiz).mockRejectedValueOnce(new Error('offline'));
    renderScreen();
    await start();

    expect(await screen.findByTestId('humor-error')).toHaveTextContent(
      'Nu am putut încărca testul de umor.',
    );

    vi.mocked(fetchQuiz).mockResolvedValue(CARDS);
    fireEvent.click(screen.getByTestId('humor-load-retry'));

    expect(await screen.findByTestId('humor-card-text')).toHaveTextContent('Gluma unu');
  });
});

describe('parcurgerea quiz-ului', () => {
  it('trece prin toate cardurile, trimite răspunsurile și confirmă salvarea', async () => {
    renderScreen();
    await start();

    expect(await screen.findByTestId('humor-card-text')).toHaveTextContent('Gluma unu');
    expect(screen.getByTestId('humor-progress')).toHaveTextContent('Gluma 1 din 2');

    fireEvent.click(screen.getByTestId('humor-funny'));

    expect(await screen.findByTestId('humor-card-text')).toHaveTextContent('Gluma doi');
    expect(screen.getByTestId('humor-progress')).toHaveTextContent('Gluma 2 din 2');

    fireEvent.click(screen.getByTestId('humor-not-funny'));

    expect(await screen.findByTestId('humor-done')).toBeInTheDocument();
    expect(screen.getByText('Profilul tău de umor a fost salvat 🎭')).toBeInTheDocument();
    expect(submitQuiz).toHaveBeenCalledTimes(1);
    expect(submitQuiz).toHaveBeenCalledWith([
      { cardId: 'c1', funny: true },
      { cardId: 'c2', funny: false },
    ]);
  });

  it('profilul salvat ajunge în cache, ca următorul ecran să nu-l mai ceară', async () => {
    const client = createTestQueryClient();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <HumorScreen />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await start();

    fireEvent.click(await screen.findByTestId('humor-funny'));
    fireEvent.click(await screen.findByTestId('humor-not-funny'));
    await screen.findByTestId('humor-done');

    expect(client.getQueryData([...HUMOR_ME_QUERY_KEY])).toEqual({ vector: { absurd: 1 } });
  });

  it('butonul final întoarce la ecranul de unde a venit userul', async () => {
    renderWithProviders(
      <MemoryRouter initialEntries={['/meniu', '/humor']} initialIndex={1}>
        <Routes>
          <Route path="/meniu" element={<p>ecranul dinainte</p>} />
          <Route path="/humor" element={<HumorScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    await start();

    fireEvent.click(await screen.findByTestId('humor-funny'));
    fireEvent.click(await screen.findByTestId('humor-not-funny'));
    fireEvent.click(await screen.findByTestId('humor-done'));

    expect(await screen.findByText('ecranul dinainte')).toBeInTheDocument();
  });
});

describe('salvarea eșuată', () => {
  it('anunță eroarea și reîncearcă cu ACELEAȘI răspunsuri, fără să piardă progresul', async () => {
    vi.mocked(submitQuiz).mockRejectedValueOnce(new Error('offline'));
    renderScreen();
    await start();

    fireEvent.click(await screen.findByTestId('humor-funny'));
    fireEvent.click(await screen.findByTestId('humor-not-funny'));

    const retry = await screen.findByTestId('humor-retry');
    expect(screen.getByText('Nu am putut salva. Reîncearcă.')).toBeInTheDocument();
    // Cardul rămâne pe ecran: userul nu e trimis înapoi la prima glumă.
    expect(screen.getByTestId('humor-card-text')).toHaveTextContent('Gluma doi');

    fireEvent.click(retry);

    expect(await screen.findByTestId('humor-done')).toBeInTheDocument();
    expect(vi.mocked(submitQuiz).mock.calls[1]?.[0]).toEqual([
      { cardId: 'c1', funny: true },
      { cardId: 'c2', funny: false },
    ]);
  });
});

describe('limba glumei', () => {
  it('alege textul cardului după limba interfeței', async () => {
    await act(async () => {
      await i18n.changeLanguage('ru');
    });
    renderScreen();

    expect(await screen.findByTestId('humor-intro-text')).toHaveTextContent(
      'Чтобы подобрать по юмору.',
    );
    await start();
    expect(await screen.findByTestId('humor-card-text')).toHaveTextContent('Шутка один');
  });

  it('cade pe română când limba cerută lipsește din card', async () => {
    vi.mocked(fetchQuiz).mockResolvedValue([
      { id: 'c1', type: 'absurd', text_ro: 'Doar în română' },
    ]);
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    renderScreen();
    await start();

    expect(await screen.findByTestId('humor-card-text')).toHaveTextContent('Doar în română');
  });
});
