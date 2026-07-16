import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import AnketeScreen from '../ankete';
import { ThemeProvider } from '@theme/index';

// Mock router (evită navigarea reală expo-router în teste).
// Prefixul `mock` e necesar ca jest să permită referința în factory-ul hoistat.
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));

// Senzorii nu există în jest. Mock-uim hook-ul de înclinare ca să-i putem
// inspecta opțiunile și să declanșăm direcții „ca de la senzor". Comportamentul
// intern al senzorului (praguri, histerezis, web, unmount) e testat separat, în
// `src/features/feed/__tests__/useTiltSwipe.test.tsx`.
type TiltOptions = { enabled: boolean; onDirection: (d: string) => void };
let lastTilt: TiltOptions | null = null;
jest.mock('@/features/feed/useTiltSwipe', () => ({
  useTiltSwipe: (options: TiltOptions) => {
    lastTilt = options;
  },
}));

/** Simulează o înclinare a telefonului în direcția dată. */
function tilt(direction: string) {
  // `act`: senzorul e o sursă din afara React, exact ca pe telefon.
  act(() => {
    lastTilt?.onDirection(direction);
  });
}

// Mock la feedApi: controlăm feed-ul și spionăm swipe / undoSwipe.
type SwipeMockResult = { matched: boolean; matchId?: string; chatId?: string | null };
const mockSwipe = jest.fn(
  (_targetUserId: string, _action: string, _message?: string): Promise<SwipeMockResult> =>
    Promise.resolve({ matched: false }),
);
const mockUndoSwipe = jest.fn(
  (): Promise<{ undone: boolean; targetUserId: string | null }> =>
    Promise.resolve({ undone: true, targetUserId: 'u1' }),
);
/** Card de feed minimal, pentru deck-uri de test. */
function card(userId: string, name: string) {
  return {
    userId,
    name,
    age: 24,
    gender: 'female',
    city: 'Chișinău',
    distanceKm: 3,
    about: 'Salut!',
    topInterests: ['sport'],
    languages: ['ro'],
    compatibility: 82,
    photos: [],
  };
}

const mockFetchFeed = jest.fn(() => Promise.resolve([card('u1', 'Ana')]));

jest.mock('@/features/feed/feedApi', () => ({
  fetchFeed: () => mockFetchFeed(),
  swipe: (targetUserId: string, action: string, message?: string) =>
    mockSwipe(targetUserId, action, message),
  undoSwipe: () => mockUndoSwipe(),
}));

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <AnketeScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

/**
 * Butoanele nu mai există: userul comandă deck-ul prin gesturi, iar cine nu poate
 * face swipe (VoiceOver) folosește exact aceste acțiuni de accesibilitate.
 */
function accessibilityAction(element: unknown, actionName: string) {
  fireEvent(element as never, 'accessibilityAction', { nativeEvent: { actionName } });
}

describe('AnketeScreen', () => {
  beforeEach(() => {
    mockSwipe.mockClear();
    mockUndoSwipe.mockClear();
    mockFetchFeed.mockClear();
    mockPush.mockClear();
  });

  it('nu mai afișează butoane de acțiune — doar cardul și indiciile de gest', async () => {
    const { getByTestId, queryByTestId } = renderScreen();

    await waitFor(() => getByTestId('deck-gestures'));
    expect(queryByTestId('swipe-like')).toBeNull();
    expect(queryByTestId('swipe-dislike')).toBeNull();
  });

  it('expune cele 4 acțiuni de accesibilitate, denumite în română', async () => {
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('deck-gestures'));
    const gestures = getByTestId('deck-gestures');

    // Fără butoane, astea sunt SINGURA cale de acces pentru un user cu VoiceOver.
    expect(gestures.props.accessible).toBe(true);
    expect(gestures.props.accessibilityActions).toEqual([
      { name: 'like', label: 'Îmi place' },
      { name: 'dislike', label: 'Nu-mi place' },
      { name: 'superLike', label: 'Super like' },
      { name: 'undo', label: 'Înapoi la anketa anterioară' },
    ]);
    // Indiciul explică gesturile: altfel userul n-are de unde ști că sus/jos există.
    expect(gestures.props.accessibilityHint).toMatch(/dreapta.*stânga.*sus.*jos/s);
  });

  it('acțiunea „like" deschide sheet-ul de mesaj de deschidere (fără swipe imediat)', async () => {
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('deck-gestures'));
    accessibilityAction(getByTestId('deck-gestures'), 'like');

    // Sheet-ul apare, dar swipe nu s-a trimis încă.
    await waitFor(() => getByTestId('first-msg-send'));
    expect(mockSwipe).not.toHaveBeenCalled();
  });

  it('„Doar like" trimite swipe „like" fără message', async () => {
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('deck-gestures'));
    accessibilityAction(getByTestId('deck-gestures'), 'like');

    await waitFor(() => getByTestId('first-msg-skip'));
    fireEvent.press(getByTestId('first-msg-skip'));

    await waitFor(() => {
      expect(mockSwipe).toHaveBeenCalledWith('u1', 'like', undefined);
    });
  });

  it('la match, „Scrie un mesaj" navighează la chatul creat', async () => {
    mockSwipe.mockResolvedValueOnce({ matched: true, matchId: 'm1', chatId: 'c1' });
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('deck-gestures'));
    accessibilityAction(getByTestId('deck-gestures'), 'like');

    // Confirmăm like-ul din sheet („Doar like"), ce declanșează match-ul.
    await waitFor(() => getByTestId('first-msg-skip'));
    fireEvent.press(getByTestId('first-msg-skip'));

    // Modalul de match apare; apăsăm „Scrie un mesaj".
    await waitFor(() => getByTestId('match-write'));
    fireEvent.press(getByTestId('match-write'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/chat/c1');
    });
  });

  it('acțiunea „dislike" trimite swipe „dislike" fără a deschide sheet-ul', async () => {
    const { getByTestId, queryByTestId } = renderScreen();

    await waitFor(() => getByTestId('deck-gestures'));
    accessibilityAction(getByTestId('deck-gestures'), 'dislike');

    await waitFor(() => {
      expect(mockSwipe).toHaveBeenCalledWith('u1', 'dislike', undefined);
    });
    expect(queryByTestId('first-msg-send')).toBeNull();
  });

  it('acțiunea „superLike" trimite swipe „super_like" pe același endpoint', async () => {
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('deck-gestures'));
    accessibilityAction(getByTestId('deck-gestures'), 'superLike');

    await waitFor(() => {
      expect(mockSwipe).toHaveBeenCalledWith('u1', 'super_like', undefined);
    });
  });

  it('super like: cât timp backendul nu acceptă „super_like", arată eroare, nu crapă', async () => {
    // Exact ce răspunde azi serverul: acțiune necunoscută → eroare.
    mockSwipe.mockRejectedValueOnce(new Error('422 unprocessable entity'));
    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => getByTestId('deck-gestures'));
    accessibilityAction(getByTestId('deck-gestures'), 'superLike');

    await waitFor(() => getByTestId('deck-action-error'));
    expect(getByText('Nu am putut trimite. Încearcă din nou.')).toBeTruthy();

    // Cardul e tot acolo, ecranul e utilizabil mai departe.
    expect(getByText(/Ana/)).toBeTruthy();
    expect(getByTestId('deck-gestures')).toBeTruthy();
  });

  it('acțiunea „undo" apelează undoSwipe după un swipe', async () => {
    const { getByTestId } = renderScreen();

    // Facem un dislike ca să existe ce anula.
    await waitFor(() => getByTestId('deck-gestures'));
    accessibilityAction(getByTestId('deck-gestures'), 'dislike');

    // Deck-ul se golește; undo rămâne disponibil ca buton în starea goală
    // (fără card pe ecran nu ai pe ce face swipe).
    await waitFor(() => getByTestId('deck-undo'));
    fireEvent.press(getByTestId('deck-undo'));

    await waitFor(() => {
      expect(mockUndoSwipe).toHaveBeenCalledTimes(1);
    });
  });

  it('când deck-ul se epuizează, oferă buton de reîncărcare', async () => {
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('deck-gestures'));
    accessibilityAction(getByTestId('deck-gestures'), 'dislike');

    // Starea goală expune butonul de reîncărcare.
    await waitFor(() => getByTestId('deck-reload'));
    fireEvent.press(getByTestId('deck-reload'));

    // Refetch reia încărcarea feed-ului.
    await waitFor(() => {
      expect(mockFetchFeed).toHaveBeenCalledTimes(2);
    });
  });

  it('când swipe-ul eșuează, arată mesaj de eroare și păstrează cardul curent', async () => {
    mockSwipe.mockRejectedValueOnce(new Error('network down'));
    const { getByTestId, getByText, queryByTestId } = renderScreen();

    await waitFor(() => getByTestId('deck-gestures'));
    accessibilityAction(getByTestId('deck-gestures'), 'dislike');

    // Userul e anunțat, nu rămâne în tăcere.
    await waitFor(() => getByTestId('deck-action-error'));
    expect(getByText('Nu am putut trimite. Încearcă din nou.')).toBeTruthy();

    // Cardul nu s-a pierdut: Ana e tot pe ecran, gesturile sunt din nou active.
    expect(getByText(/Ana/)).toBeTruthy();
    expect(getByTestId('deck-gestures')).toBeTruthy();

    // La o reîncercare reușită, eroarea dispare și deck-ul avansează.
    accessibilityAction(getByTestId('deck-gestures'), 'dislike');
    await waitFor(() => getByTestId('deck-reload'));
    expect(queryByTestId('deck-action-error')).toBeNull();
  });

  it('undo revine la cardul anterior, nu la primul card din deck', async () => {
    // Deck de 3 carduri: doar așa se vede diferența dintre „cardul anterior" și index 0.
    mockFetchFeed.mockResolvedValueOnce([
      card('u1', 'Ana'),
      card('u2', 'Bogdan'),
      card('u3', 'Corina'),
    ]);
    const { getByTestId, getByText, queryByText } = renderScreen();

    // Două dislike-uri: Ana → Bogdan → Corina.
    await waitFor(() => getByText(/Ana/));
    accessibilityAction(getByTestId('deck-gestures'), 'dislike');
    await waitFor(() => getByText(/Bogdan/));
    accessibilityAction(getByTestId('deck-gestures'), 'dislike');
    await waitFor(() => getByText(/Corina/));

    // Undo → trebuie să revină la Bogdan (cardul anterior), nu la Ana (index 0).
    accessibilityAction(getByTestId('deck-gestures'), 'undo');
    await waitFor(() => {
      expect(mockUndoSwipe).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => getByText(/Bogdan/));
    expect(queryByText(/Ana/)).toBeNull();
  });

  describe('înclinarea telefonului (giroscop)', () => {
    it('înclinarea în dreapta trece prin același drum ca swipe-ul (deschide sheet-ul)', async () => {
      const { getByTestId } = renderScreen();
      await waitFor(() => getByTestId('deck-gestures'));

      tilt('right');

      await waitFor(() => getByTestId('first-msg-send'));
      expect(mockSwipe).not.toHaveBeenCalled();
    });

    it('înclinarea în stânga trimite dislike (după animația de confirmare)', async () => {
      const { getByTestId } = renderScreen();
      await waitFor(() => getByTestId('deck-gestures'));

      tilt('left');

      await waitFor(() => {
        expect(mockSwipe).toHaveBeenCalledWith('u1', 'dislike', undefined);
      });
    });

    it('înclinarea în sus trimite super_like', async () => {
      const { getByTestId } = renderScreen();
      await waitFor(() => getByTestId('deck-gestures'));

      tilt('up');

      await waitFor(() => {
        expect(mockSwipe).toHaveBeenCalledWith('u1', 'super_like', undefined);
      });
    });

    it('înclinarea în jos face undo', async () => {
      const { getByTestId } = renderScreen();
      await waitFor(() => getByTestId('deck-gestures'));

      // Întâi un dislike, ca să existe ce anula.
      accessibilityAction(getByTestId('deck-gestures'), 'dislike');
      await waitFor(() => getByTestId('deck-reload'));

      tilt('down');
      await waitFor(() => {
        expect(mockUndoSwipe).toHaveBeenCalledTimes(1);
      });
    });

    it('senzorul tace cât timp e deschis sheet-ul de mesaj', async () => {
      const { getByTestId } = renderScreen();
      await waitFor(() => getByTestId('deck-gestures'));
      expect(lastTilt?.enabled).toBe(true);

      accessibilityAction(getByTestId('deck-gestures'), 'like');
      await waitFor(() => getByTestId('first-msg-send'));

      // Altfel userul ar da like/dislike „pe nevăzute", pe cardul din spatele sheet-ului.
      expect(lastTilt?.enabled).toBe(false);
    });

    it('senzorul tace cât timp e deschis modalul de match', async () => {
      mockSwipe.mockResolvedValueOnce({ matched: true, matchId: 'm1', chatId: 'c1' });
      const { getByTestId } = renderScreen();
      await waitFor(() => getByTestId('deck-gestures'));

      accessibilityAction(getByTestId('deck-gestures'), 'like');
      await waitFor(() => getByTestId('first-msg-skip'));
      fireEvent.press(getByTestId('first-msg-skip'));

      await waitFor(() => getByTestId('match-write'));
      expect(lastTilt?.enabled).toBe(false);
    });
  });

  it('nu înghite butoanele de siguranță din card (favorit / raportare / blocare)', async () => {
    // Regresie: dacă am pune `accessible` pe card ca să prindem acțiunile a11y,
    // butoanele astea ar dispărea pentru VoiceOver.
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('deck-gestures'));
    expect(getByTestId('card-favorite')).toBeTruthy();
    expect(getByTestId('card-report')).toBeTruthy();
    expect(getByTestId('card-block')).toBeTruthy();
  });
});
