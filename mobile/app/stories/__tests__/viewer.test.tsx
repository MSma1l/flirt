import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import StoryViewerScreen from '../[userId]';
import { ThemeProvider } from '@theme/index';
import type { UserStories } from '@/features/stories/types';

// Insets deterministe (notch + bară gestuală): ecranul le folosește ca să nu
// pună comenzile sub notch, iar `useSafeAreaInsets` are nevoie de provider.
const INSET_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

// Mock router + parametru de rută.
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ userId: 'u1' }),
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
}));

// Id-ul utilizatorului curent — controlabil (proprietar vs. vizitator).
const mockAuth = { userId: 'me' };
jest.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) =>
    selector({ user: { id: mockAuth.userId } }),
}));

// Mock la storiesApi: sursă controlată + spionăm ștergerea.
const groups: UserStories[] = [
  {
    userId: 'u1',
    name: 'Ana',
    storyCount: 2,
    stories: [
      {
        id: 's1',
        userId: 'u1',
        mediaUrl: 'https://x/1.jpg',
        mediaType: 'image',
        caption: 'Prima poveste',
        createdAt: '2026-07-01T10:00:00Z',
        expiresAt: '2026-07-02T10:00:00Z',
      },
      {
        id: 's2',
        userId: 'u1',
        mediaUrl: 'https://x/2.mp4',
        mediaType: 'video',
        caption: 'A doua poveste',
        createdAt: '2026-07-01T11:00:00Z',
        expiresAt: '2026-07-02T11:00:00Z',
      },
    ],
  },
];
const mockFetchStories = jest.fn<Promise<UserStories[]>, []>(() => Promise.resolve(groups));
const mockDeleteStory = jest.fn((_id: string) => Promise.resolve());
const mockReplyToStory = jest.fn((id: string, body: string) =>
  Promise.resolve({ chatId: 'c1', messageId: 'm1', body }),
);
jest.mock('@/features/stories/storiesApi', () => ({
  fetchStories: () => mockFetchStories(),
  deleteStory: (id: string) => mockDeleteStory(id),
  replyToStory: (id: string, body: string) => mockReplyToStory(id, body),
}));

function wrap(client: QueryClient) {
  return (
    <SafeAreaProvider initialMetrics={INSET_METRICS}>
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <StoryViewerScreen />
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // Sursa vizualizatorului este cache-ul din bara de stories.
  client.setQueryData(['stories'], groups);
  return render(wrap(client));
}

/** Randare FĂRĂ cache pre-populat (intrare directă, nu prin bara de stories). */
function renderColdScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(wrap(client));
}

describe('StoryViewerScreen', () => {
  beforeEach(() => {
    mockFetchStories.mockReset();
    mockFetchStories.mockResolvedValue(groups);
    mockDeleteStory.mockClear();
    mockReplyToStory.mockClear();
    mockBack.mockClear();
    mockAuth.userId = 'me';
  });

  it('tap dreapta avansează la povestea următoare', () => {
    const { getByText, getByLabelText } = renderScreen();

    expect(getByText('Prima poveste')).toBeTruthy();
    fireEvent.press(getByLabelText('Povestea următoare'));
    expect(getByText('A doua poveste')).toBeTruthy();
  });

  it('tap dreapta pe ULTIMA poveste închide ecranul (router.back), o singură dată', () => {
    const { getByLabelText } = renderScreen();

    fireEvent.press(getByLabelText('Povestea următoare')); // s1 -> s2 (ultima)
    fireEvent.press(getByLabelText('Povestea următoare')); // ultima -> închide

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('avansul automat trece la povestea următoare, apoi închide — fără setState în randare', () => {
    jest.useFakeTimers();
    // `router.back()` se chema dintr-un updater de state, pe care React îl rulează
    // în timpul randării → avertisment „Cannot update a component while rendering".
    // Îl prindem ca eroare ca să nu se poată strecura înapoi.
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { getByText } = renderScreen();

      expect(getByText('Prima poveste')).toBeTruthy();

      // Prima poveste expiră → avans automat la a doua.
      act(() => {
        // Puțin peste durata poveștii: pasul de progres (50/4000) se acumulează
        // în virgulă mobilă, deci pragul e atins la tick-ul imediat următor.
        jest.advanceTimersByTime(4200);
      });
      expect(getByText('A doua poveste')).toBeTruthy();
      expect(mockBack).not.toHaveBeenCalled();

      // A doua (ultima) expiră → se închide.
      act(() => {
        // Puțin peste durata poveștii: pasul de progres (50/4000) se acumulează
        // în virgulă mobilă, deci pragul e atins la tick-ul imediat următor.
        jest.advanceTimersByTime(4200);
      });
      expect(mockBack).toHaveBeenCalledTimes(1);

      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('povestea video afișează media de tip video (nu imagine)', () => {
    const { getByTestId, queryByTestId, getByLabelText } = renderScreen();

    // Prima e imagine.
    expect(getByTestId('story-image')).toBeTruthy();

    // A doua e video → placeholder nativ de video, fără <Image>.
    fireEvent.press(getByLabelText('Povestea următoare'));
    expect(getByTestId('story-video-fallback')).toBeTruthy();
    expect(queryByTestId('story-image')).toBeNull();
  });

  it('proprietarul poate șterge povestea (deleteStory)', async () => {
    mockAuth.userId = 'u1';
    const { getByLabelText } = renderScreen();

    fireEvent.press(getByLabelText('Șterge povestea'));

    await waitFor(() => expect(mockDeleteStory).toHaveBeenCalledWith('s1'));
  });

  /* --- Fără cache: încărcare / eroare / gol trebuie să se distingă între ele --- */

  it('cât timp poveștile se încarcă arată spinner, NU mesajul de gol', async () => {
    // Promisiune ținută în aer: rămânem în starea de încărcare.
    let resolve: (v: UserStories[]) => void = () => {};
    mockFetchStories.mockReturnValue(
      new Promise<UserStories[]>((r) => {
        resolve = r;
      }),
    );

    const { getByTestId, queryByText } = renderColdScreen();

    expect(getByTestId('stories-loading')).toBeTruthy();
    expect(queryByText('Nu există povești de afișat.')).toBeNull();

    resolve(groups);
    await waitFor(() => expect(queryByText('Prima poveste')).toBeTruthy());
  });

  it('la eroare arată mesajul + „Reîncearcă", NU mesajul de gol', async () => {
    mockFetchStories.mockRejectedValueOnce(new Error('boom'));
    const { getByText, queryByText } = renderColdScreen();

    await waitFor(() => getByText('Nu am putut încărca poveștile.'));
    expect(queryByText('Nu există povești de afișat.')).toBeNull();

    // Retry: a doua oară datele vin.
    mockFetchStories.mockResolvedValue(groups);
    fireEvent.press(getByText('Reîncearcă'));

    await waitFor(() => getByText('Prima poveste'));
  });

  it('gol REAL (răspuns fără povești) → mesajul de gol cu „Închide"', async () => {
    mockFetchStories.mockResolvedValue([]);
    const { getByText, getByLabelText } = renderColdScreen();

    await waitFor(() => getByText('Nu există povești de afișat.'));

    fireEvent.press(getByLabelText('Închide'));
    expect(mockBack).toHaveBeenCalled();
  });

  /* --- Full-screen: poza umple TOT ecranul, comenzile rămân atingibile --- */

  it('poza umple tot ecranul (absolut, „cover"), nu o zonă mică', () => {
    const { getByTestId } = renderScreen();

    const image = getByTestId('story-image');
    expect(image.props.resizeMode).toBe('cover');

    const flat = StyleSheet.flatten(image.props.style);
    expect(flat.position).toBe('absolute');
    expect(flat.top).toBe(0);
    expect(flat.left).toBe(0);
    expect(flat.right).toBe(0);
    expect(flat.bottom).toBe(0);
  });

  it('comenzile respectă insets: „✕" sub notch nu, bara de răspuns nu sub bara gestuală', () => {
    const { getByTestId } = renderScreen();

    // Overlay-ul de sus e împins sub notch (top = 47).
    const top = StyleSheet.flatten(getByTestId('story-top-overlay').props.style);
    expect(top.paddingTop).toBe(INSET_METRICS.insets.top);

    // Zona de jos stă deasupra barei gestuale (bottom = 34 + spațiere).
    const bottom = StyleSheet.flatten(getByTestId('story-bottom-overlay').props.style);
    expect(bottom.paddingBottom).toBeGreaterThan(INSET_METRICS.insets.bottom);
  });

  /* --- Răspuns la povestea altcuiva --- */

  it('la povestea altcuiva apare bara de răspuns; la a mea, nu (doar ștergere)', () => {
    const { getByTestId } = renderScreen();
    expect(getByTestId('story-reply-bar')).toBeTruthy();

    mockAuth.userId = 'u1'; // povestea mea
    const mine = renderScreen();
    expect(mine.queryByTestId('story-reply-bar')).toBeNull();
    expect(mine.getByLabelText('Șterge povestea')).toBeTruthy();
  });

  it('tap pe emoji trimite imediat un răspuns la povestea curentă', async () => {
    const { getByLabelText } = renderScreen();

    fireEvent.press(getByLabelText('Reacționează cu ❤️'));

    await waitFor(() => expect(mockReplyToStory).toHaveBeenCalledWith('s1', '❤️'));
  });

  it('mesajul liber se trimite cu „Trimite" și golește câmpul', async () => {
    const { getByLabelText, getByTestId } = renderScreen();

    fireEvent.changeText(getByTestId('story-reply-input'), '  Ce poză tare!  ');
    fireEvent.press(getByLabelText('Trimite răspunsul'));

    await waitFor(() => expect(mockReplyToStory).toHaveBeenCalledWith('s1', 'Ce poză tare!'));
    expect(getByTestId('story-reply-input').props.value).toBe('');
  });

  it('un răspuns gol nu pleacă', () => {
    const { getByLabelText, getByTestId } = renderScreen();

    fireEvent.changeText(getByTestId('story-reply-input'), '   ');
    fireEvent.press(getByLabelText('Trimite răspunsul'));

    expect(mockReplyToStory).not.toHaveBeenCalled();
  });

  it('CÂT TIMP userul scrie, povestea NU avansează și NU se închide', () => {
    jest.useFakeTimers();
    try {
      const { getByText, getByTestId, queryByText } = renderScreen();

      // Focus pe câmp = userul scrie → progresul se oprește.
      fireEvent(getByTestId('story-reply-input'), 'focus');
      act(() => {
        jest.advanceTimersByTime(20000); // mult peste durata ambelor povești
      });
      expect(getByText('Prima poveste')).toBeTruthy();
      expect(queryByText('A doua poveste')).toBeNull();
      expect(mockBack).not.toHaveBeenCalled();

      // Câmpul rămâne cu text după blur → tot oprit (userul n-a terminat).
      fireEvent.changeText(getByTestId('story-reply-input'), 'scriu ceva');
      fireEvent(getByTestId('story-reply-input'), 'blur');
      act(() => {
        jest.advanceTimersByTime(20000);
      });
      expect(getByText('Prima poveste')).toBeTruthy();

      // Câmp golit și fără focus → povestea își reia cursul.
      fireEvent.changeText(getByTestId('story-reply-input'), '');
      act(() => {
        jest.advanceTimersByTime(4200);
      });
      expect(getByText('A doua poveste')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  /* --- Pauză la apăsare lungă (fără NICIUN indicator vizual — cerință) --- */

  it('apăsarea lungă oprește timpul; ridicarea degetului îl reia de unde a rămas', () => {
    jest.useFakeTimers();
    try {
      const { getByText, getByTestId, queryByText } = renderScreen();

      // ~3s din 4s consumate, apoi degetul se lasă apăsat.
      act(() => {
        jest.advanceTimersByTime(3000);
      });
      fireEvent(getByTestId('story-tap-next'), 'longPress');

      // Oricât ține degetul, povestea stă pe loc.
      act(() => {
        jest.advanceTimersByTime(60000);
      });
      expect(getByText('Prima poveste')).toBeTruthy();
      expect(queryByText('A doua poveste')).toBeNull();
      expect(mockBack).not.toHaveBeenCalled();

      // Ridică degetul → continuă de UNDE A RĂMAS: mai trebuie ~1s, nu încă 4.
      fireEvent(getByTestId('story-tap-next'), 'pressOut');
      act(() => {
        jest.advanceTimersByTime(1200);
      });
      expect(getByText('A doua poveste')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('apăsarea lungă NU navighează (doar pune pauză)', () => {
    jest.useFakeTimers();
    try {
      const { getByText, getByTestId } = renderScreen();

      // RN nu cheamă `onPress` după ce `onLongPress` s-a declanșat.
      fireEvent(getByTestId('story-tap-next'), 'longPress');
      fireEvent(getByTestId('story-tap-next'), 'pressOut');

      expect(getByText('Prima poveste')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('tap SCURT navighează și NU lasă povestea pe pauză', () => {
    jest.useFakeTimers();
    try {
      const { getByText, getByTestId } = renderScreen();

      // Tap scurt = pressIn → pressOut → press, fără longPress.
      fireEvent(getByTestId('story-tap-next'), 'pressIn');
      fireEvent(getByTestId('story-tap-next'), 'pressOut');
      fireEvent.press(getByTestId('story-tap-next'));
      expect(getByText('A doua poveste')).toBeTruthy();

      // Timpul curge mai departe → ultima poveste expiră și ecranul se închide.
      act(() => {
        jest.advanceTimersByTime(4200);
      });
      expect(mockBack).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('pauza se eliberează dacă gestul e ANULAT (degetul iese din ecran)', () => {
    jest.useFakeTimers();
    try {
      const { getByText, getByTestId } = renderScreen();

      fireEvent(getByTestId('story-tap-next'), 'longPress');
      // RN cheamă `onPressOut` și la anularea gestului, nu doar la ridicare.
      fireEvent(getByTestId('story-tap-next'), 'pressOut');

      act(() => {
        jest.advanceTimersByTime(4200);
      });
      expect(getByText('A doua poveste')).toBeTruthy(); // NU a rămas blocată
    } finally {
      jest.useRealTimers();
    }
  });

  it('ridicarea degetului în timp ce userul TASTEAZĂ nu repornește povestea', () => {
    jest.useFakeTimers();
    try {
      const { getByText, getByTestId, queryByText } = renderScreen();

      // Userul scrie un răspuns...
      fireEvent(getByTestId('story-reply-input'), 'focus');
      // ...și între timp ține degetul pe ecran, apoi îl ridică.
      fireEvent(getByTestId('story-tap-next'), 'longPress');
      fireEvent(getByTestId('story-tap-next'), 'pressOut');

      // Motivul „reply" e încă activ → povestea RĂMÂNE pe pauză.
      act(() => {
        jest.advanceTimersByTime(20000);
      });
      expect(getByText('Prima poveste')).toBeTruthy();
      expect(queryByText('A doua poveste')).toBeNull();
      expect(mockBack).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('progresul se RELUĂ de unde a rămas, nu de la zero', () => {
    jest.useFakeTimers();
    try {
      const { getByText, getByTestId } = renderScreen();

      // ~3s din 4s, apoi pauză lungă cât scrie userul.
      act(() => {
        jest.advanceTimersByTime(3000);
      });
      fireEvent(getByTestId('story-reply-input'), 'focus');
      act(() => {
        jest.advanceTimersByTime(30000);
      });
      expect(getByText('Prima poveste')).toBeTruthy();

      // Reluare: mai trebuie ~1s, nu încă 4.
      fireEvent(getByTestId('story-reply-input'), 'blur');
      act(() => {
        jest.advanceTimersByTime(1200);
      });
      expect(getByText('A doua poveste')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});
