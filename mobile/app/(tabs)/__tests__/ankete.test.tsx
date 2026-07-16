import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import AnketeScreen from '../ankete';
import { ThemeProvider } from '@theme/index';

// Mock router (evită navigarea reală expo-router în teste).
// Prefixul `mock` e necesar ca jest să permită referința în factory-ul hoistat.
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));

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

describe('AnketeScreen', () => {
  beforeEach(() => {
    mockSwipe.mockClear();
    mockUndoSwipe.mockClear();
    mockFetchFeed.mockClear();
    mockPush.mockClear();
  });

  it('la like deschide sheet-ul de mesaj de deschidere (fără swipe imediat)', async () => {
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('swipe-like'));
    fireEvent.press(getByTestId('swipe-like'));

    // Sheet-ul apare, dar swipe nu s-a trimis încă.
    await waitFor(() => getByTestId('first-msg-send'));
    expect(mockSwipe).not.toHaveBeenCalled();
  });

  it('„Doar like" trimite swipe „like" fără message', async () => {
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('swipe-like'));
    fireEvent.press(getByTestId('swipe-like'));

    await waitFor(() => getByTestId('first-msg-skip'));
    fireEvent.press(getByTestId('first-msg-skip'));

    await waitFor(() => {
      expect(mockSwipe).toHaveBeenCalledWith('u1', 'like', undefined);
    });
  });

  it('la match, „Scrie un mesaj" navighează la chatul creat', async () => {
    mockSwipe.mockResolvedValueOnce({ matched: true, matchId: 'm1', chatId: 'c1' });
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('swipe-like'));
    fireEvent.press(getByTestId('swipe-like'));

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

  it('dislike trimite swipe „dislike" fără a deschide sheet-ul', async () => {
    const { getByTestId, queryByTestId } = renderScreen();

    await waitFor(() => getByTestId('swipe-dislike'));
    fireEvent.press(getByTestId('swipe-dislike'));

    await waitFor(() => {
      expect(mockSwipe).toHaveBeenCalledWith('u1', 'dislike', undefined);
    });
    expect(queryByTestId('first-msg-send')).toBeNull();
  });

  it('undo apelează undoSwipe după un swipe', async () => {
    const { getByTestId } = renderScreen();

    // Facem un dislike ca să existe ce anula.
    await waitFor(() => getByTestId('swipe-dislike'));
    fireEvent.press(getByTestId('swipe-dislike'));

    // Deck-ul se golește; butonul de undo devine disponibil în starea goală.
    await waitFor(() => getByTestId('deck-undo'));
    fireEvent.press(getByTestId('deck-undo'));

    await waitFor(() => {
      expect(mockUndoSwipe).toHaveBeenCalledTimes(1);
    });
  });

  it('când deck-ul se epuizează, oferă buton de reîncărcare', async () => {
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('swipe-dislike'));
    fireEvent.press(getByTestId('swipe-dislike'));

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

    await waitFor(() => getByTestId('swipe-dislike'));
    fireEvent.press(getByTestId('swipe-dislike'));

    // Userul e anunțat, nu rămâne în tăcere.
    await waitFor(() => getByTestId('deck-action-error'));
    expect(getByText('Nu am putut trimite. Încearcă din nou.')).toBeTruthy();

    // Cardul nu s-a pierdut: Ana e tot pe ecran, butoanele sunt din nou active.
    expect(getByText(/Ana/)).toBeTruthy();
    expect(getByTestId('swipe-dislike')).toBeTruthy();

    // La o reîncercare reușită, eroarea dispare și deck-ul avansează.
    fireEvent.press(getByTestId('swipe-dislike'));
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
    fireEvent.press(getByTestId('swipe-dislike'));
    await waitFor(() => getByText(/Bogdan/));
    fireEvent.press(getByTestId('swipe-dislike'));
    await waitFor(() => getByText(/Corina/));

    // Undo → trebuie să revină la Bogdan (cardul anterior), nu la Ana (index 0).
    fireEvent.press(getByTestId('deck-undo'));
    await waitFor(() => {
      expect(mockUndoSwipe).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => getByText(/Bogdan/));
    expect(queryByText(/Ana/)).toBeNull();
  });
});
