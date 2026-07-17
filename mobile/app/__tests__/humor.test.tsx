import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import HumorScreen from '../humor';
import { HUMOR_ME_QUERY_KEY, useHumorGateStore } from '@/features/humor/humorGate';
import type { HumorCard } from '@/features/humor/types';
import i18n from '@/i18n';
import ruHumor from '@/i18n/locales/ru/humor.json';
import { ThemeProvider } from '@theme/index';

// Mock router (evită navigarea reală expo-router în teste).
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn() }),
}));

// Ecranul are nevoie de id-ul userului pentru supapa „quiz indisponibil".
jest.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) =>
    selector({ user: { id: 'u1' } }),
}));

// Mock la humorApi: cardurile testului + spionăm submit-ul.
const mockFetchQuiz = jest.fn<Promise<HumorCard[]>, []>(() => Promise.resolve([]));
const mockSubmitQuiz = jest.fn((_answers: unknown) => Promise.resolve({ vector: {} }));
jest.mock('@/features/humor/humorApi', () => ({
  fetchQuiz: () => mockFetchQuiz(),
  submitQuiz: (answers: unknown) => mockSubmitQuiz(answers),
  fetchHumor: jest.fn(),
}));

/** Cardurile așa cum le trimite serverul: gluma în toate cele 4 limbi. */
const cards: HumorCard[] = [
  {
    id: 'h1',
    type: 'pun',
    text_ro: 'Prima glumă',
    text_ru: 'Первая шутка',
    text_uk: 'Перший жарт',
    text_en: 'First joke',
  },
  {
    id: 'h2',
    type: 'absurd',
    text_ro: 'A doua glumă',
    text_ru: 'Вторая шутка',
    text_uk: 'Другий жарт',
    text_en: 'Second joke',
  },
];

let client: QueryClient;

function renderScreen() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <HumorScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('HumorScreen', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockSubmitQuiz.mockResolvedValue({ vector: {} });
    useHumorGateStore.getState().reset();
    await i18n.changeLanguage('ro');
  });

  afterAll(async () => {
    await i18n.changeLanguage('ro');
  });

  it('parcurge cardurile și la final apelează submitQuiz cu răspunsurile', async () => {
    mockFetchQuiz.mockResolvedValue(cards);
    mockSubmitQuiz.mockResolvedValue({ vector: { pun: 1 } });
    const { getByTestId, getByText } = renderScreen();

    // Primul card.
    await waitFor(() => getByText('Prima glumă'));
    fireEvent.press(getByTestId('humor-funny'));

    // Al doilea card → răspunsul final declanșează submit-ul.
    await waitFor(() => getByText('A doua glumă'));
    fireEvent.press(getByTestId('humor-not-funny'));

    await waitFor(() => {
      expect(mockSubmitQuiz).toHaveBeenCalledWith([
        { cardId: 'h1', funny: true },
        { cardId: 'h2', funny: false },
      ]);
    });

    // La succes se arată confirmarea.
    await waitFor(() => getByTestId('humor-done'));
    expect(getByText('Profilul tău de umor a fost salvat 🎭')).toBeTruthy();
  });

  it('la succes umple cache-ul porții și duce userul în feed (fără buclă quiz→feed→quiz)', async () => {
    mockFetchQuiz.mockResolvedValue([cards[0]]);
    mockSubmitQuiz.mockResolvedValue({ vector: { pun: 1 } });
    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => getByText('Prima glumă'));
    fireEvent.press(getByTestId('humor-funny'));

    await waitFor(() => getByTestId('humor-done'));
    // Poarta citește aceeași cheie: vede imediat vectorul plin, deci nu mai
    // trimite userul înapoi la quiz.
    expect(client.getQueryData(HUMOR_ME_QUERY_KEY)).toEqual({ vector: { pun: 1 } });

    fireEvent.press(getByTestId('humor-done'));
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/ankete');
  });

  it('onError afișează mesaj și buton de reîncercare', async () => {
    mockFetchQuiz.mockResolvedValue([cards[0]]);
    mockSubmitQuiz.mockRejectedValueOnce(new Error('boom'));
    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => getByText('Prima glumă'));
    fireEvent.press(getByTestId('humor-funny'));

    await waitFor(() => getByText('Nu am putut salva. Reîncearcă.'));
    expect(getByTestId('humor-retry')).toBeTruthy();

    // Reîncercarea chiar retrimite aceleași răspunsuri — nu e un ecran mort.
    mockSubmitQuiz.mockResolvedValue({ vector: { pun: 1 } });
    fireEvent.press(getByTestId('humor-retry'));
    await waitFor(() => getByTestId('humor-done'));
  });

  describe('limba: gluma (text de la server)', () => {
    it('afișează gluma în limba activă, nu în română', async () => {
      await i18n.changeLanguage('uk');
      mockFetchQuiz.mockResolvedValue(cards);
      const { getByTestId } = renderScreen();

      await waitFor(() =>
        expect(getByTestId('humor-card-text').props.children).toBe('Перший жарт'),
      );
    });

    it('lipsește textul în limba activă → cade pe română, NU rămâne gol', async () => {
      await i18n.changeLanguage('ru');
      mockFetchQuiz.mockResolvedValue([{ ...cards[0], text_ru: undefined }]);
      const { getByTestId } = renderScreen();

      await waitFor(() =>
        expect(getByTestId('humor-card-text').props.children).toBe('Prima glumă'),
      );
    });
  });

  describe('limba: chrome-ul ecranului (catalogul `humor`)', () => {
    /** Titlu + butoane + progres, în fiecare limbă. */
    const chrome = {
      ro: {
        title: 'Simțul umorului',
        funny: '😂 Amuzant',
        notFunny: '😐 Nu prea',
        progress: 'Gluma 1 din 2',
      },
      ru: {
        title: 'Чувство юмора',
        funny: '😂 Смешно',
        notFunny: '😐 Не очень',
        progress: 'Шутка 1 из 2',
      },
      uk: {
        title: 'Почуття гумору',
        funny: '😂 Смішно',
        notFunny: '😐 Не дуже',
        progress: 'Жарт 1 з 2',
      },
      en: {
        title: 'Sense of humor',
        funny: '😂 Funny',
        notFunny: '😐 Not really',
        progress: 'Joke 1 of 2',
      },
    } as const;

    it.each(['ro', 'ru', 'uk', 'en'] as const)(
      'în „%s" titlul, butoanele și progresul sunt în limba activă',
      async (lang) => {
        await i18n.changeLanguage(lang);
        mockFetchQuiz.mockResolvedValue(cards);
        const { getByTestId, getByText } = renderScreen();

        await waitFor(() => getByText(chrome[lang].title));
        expect(getByTestId('humor-progress').props.children).toBe(chrome[lang].progress);
        // Butoanele: verificăm eticheta randată, nu doar testID-ul.
        expect(getByText(chrome[lang].funny)).toBeTruthy();
        expect(getByText(chrome[lang].notFunny)).toBeTruthy();
      },
    );

    it('mesajele de eroare + reîncercarea sunt în limba activă', async () => {
      await i18n.changeLanguage('uk');
      mockFetchQuiz.mockRejectedValue(new Error('500'));
      const { getByText } = renderScreen();

      await waitFor(() => getByText('Не вдалося завантажити тест на почуття гумору.'));
      expect(getByText('Спробувати ще раз')).toBeTruthy();
      expect(getByText('Перейти до застосунку')).toBeTruthy();
    });

    it('confirmarea de la final e în limba activă', async () => {
      await i18n.changeLanguage('ru');
      mockFetchQuiz.mockResolvedValue([cards[0]]);
      mockSubmitQuiz.mockResolvedValue({ vector: { pun: 1 } });
      const { getByTestId, getByText } = renderScreen();

      await waitFor(() => getByTestId('humor-funny'));
      fireEvent.press(getByTestId('humor-funny'));

      await waitFor(() => getByText('Ваш профиль юмора сохранён 🎭'));
      expect(getByText('Продолжить')).toBeTruthy();
    });

    it('cheie lipsă într-o limbă → cade pe română, NU rămâne gol', async () => {
      // Simulăm o traducere neintrodusă încă, peste catalogul real: `fallbackLng`
      // trebuie să dea textul românesc, nu cheia brută („quiz.title") și nici gol.
      i18n.removeResourceBundle('ru', 'humor');
      i18n.addResourceBundle('ru', 'humor', { quiz: { funny: '😂 Смешно' } });
      await i18n.changeLanguage('ru');
      mockFetchQuiz.mockResolvedValue(cards);

      const { getByTestId, getByText } = renderScreen();

      // Cheia tradusă rămâne în rusă...
      await waitFor(() => getByText('😂 Смешно'));
      // ...iar cele lipsă cad pe română, nu pe „quiz.title" și nu pe gol.
      expect(getByText('Simțul umorului')).toBeTruthy();
      expect(getByTestId('humor-progress').props.children).toBe('Gluma 1 din 2');

      // Restaurăm catalogul real pentru testele următoare.
      i18n.removeResourceBundle('ru', 'humor');
      i18n.addResourceBundle('ru', 'humor', ruHumor);
    });
  });

  describe('quiz-ul obligatoriu nu devine zid', () => {
    it('`GET /humor/quiz` cade → userul poate reîncerca SAU intra în aplicație', async () => {
      mockFetchQuiz.mockRejectedValue(new Error('500'));
      const { getByTestId, getByText } = renderScreen();

      await waitFor(() => getByText('Nu am putut încărca testul de umor.'));

      fireEvent.press(getByTestId('humor-continue-anyway'));

      // Supapa deschide poarta DOAR pentru sesiunea curentă (nu se persistă),
      // altfel userul ar rămâne prins: poarta îl trimite la quiz, iar quiz-ul
      // nu se încarcă.
      expect(useHumorGateStore.getState().unavailableForUserId).toBe('u1');
      expect(mockReplace).toHaveBeenCalledWith('/(tabs)/ankete');
    });

    it('quiz gol de la server → userul nu rămâne pe un ecran fără ieșire', async () => {
      mockFetchQuiz.mockResolvedValue([]);
      const { getByTestId, getByText } = renderScreen();

      await waitFor(() => getByText('Nu există glume disponibile deocamdată.'));

      fireEvent.press(getByTestId('humor-continue-anyway'));
      expect(useHumorGateStore.getState().unavailableForUserId).toBe('u1');
      expect(mockReplace).toHaveBeenCalledWith('/(tabs)/ankete');
    });
  });
});
