/**
 * Completarea feedului pe trepte: când potrivirile stricte se termină, serverul
 * umple lotul cu carduri `outside_filters` (`relaxed`, `other_gender`). Cardul
 * le marchează discret. TRECERI: serverul nu repetă nimic în aceeași trecere, iar
 * după ce userul i-a văzut pe toți o ia de la capăt (refuzații revin ca
 * `second_chance`) — deck-ul continuă fără ecranul gol și fără dubluri.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FallbackTier, FeedCard } from '@mobile/features/feed/types';

import i18n from '@/i18n';
import { createTestQueryClient, renderWithProviders } from '@/test/harness';

import { ProfileCardView } from '../ProfileCardView';
import { SwipeDeck } from '../SwipeDeck';

vi.mock('@mobile/features/feed/feedApi', () => ({
  fetchFeed: vi.fn(),
  swipe: vi.fn(),
  undoSwipe: vi.fn(),
}));

vi.mock('@/features/stories/storiesApi', () => ({
  fetchStories: vi.fn(async () => []),
  fetchMyStories: vi.fn(async () => []),
  uploadStoryMedia: vi.fn(),
  createStory: vi.fn(),
  replyToStory: vi.fn(),
  deleteStory: vi.fn(),
}));

vi.mock('@/features/profile/profileApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/profile/profileApi')>();
  return {
    ...actual,
    fetchReference: vi.fn(async () => ({ genders: [], datingStatuses: [], languages: [], interests: [] })),
  };
});

const { fetchFeed, swipe, undoSwipe } = await import('@mobile/features/feed/feedApi');

function card(id: string, extra: Partial<FeedCard> = {}): FeedCard {
  return {
    userId: id,
    name: `Nume-${id}`,
    age: 25,
    gender: 'f',
    city: 'Chișinău',
    about: '',
    topInterests: [],
    languages: ['ro'],
    compatibility: 50,
    photos: [],
    ...extra,
  };
}

function tier(id: string, fallbackTier: FallbackTier): FeedCard {
  return card(id, { outsideFilters: true, fallbackTier });
}

const initialLanguage = i18n.language;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(async () => {
  await i18n.changeLanguage(initialLanguage);
});

describe('eticheta cardurilor de completare', () => {
  const CASES: Array<[FallbackTier, Record<'ro' | 'ru' | 'en', string>]> = [
    ['relaxed', { ro: 'În afara filtrelor tale', ru: 'Вне ваших фильтров', en: 'Outside your filters' }],
    ['second_chance', { ro: 'Încă o șansă', ru: 'Ещё один шанс', en: 'Second chance' }],
    // Genul NU e scos în evidență: același text ca la `relaxed`.
    ['other_gender', { ro: 'În afara filtrelor tale', ru: 'Вне ваших фильтров', en: 'Outside your filters' }],
  ];

  for (const [fallbackTier, texts] of CASES) {
    for (const lang of ['ro', 'ru', 'en'] as const) {
      it(`${fallbackTier} (${lang}) → „${texts[lang]}"`, async () => {
        await i18n.changeLanguage(lang);
        renderWithProviders(<ProfileCardView card={tier('a', fallbackTier)} />);
        const chip = screen.getByTestId('profile-card-tier');
        expect(chip).toHaveTextContent(texts[lang]);
        expect(chip).toHaveClass('profile-card__tier');
      });
    }
  }

  it('lipsește pe un card normal', () => {
    renderWithProviders(
      <ProfileCardView card={card('n', { outsideFilters: false, fallbackTier: null })} />,
    );
    expect(screen.queryByTestId('profile-card-tier')).not.toBeInTheDocument();
  });

  it('lipsește pe un card de la un server vechi (fără câmpurile noi)', () => {
    renderWithProviders(<ProfileCardView card={card('old')} />);
    expect(screen.queryByTestId('profile-card-tier')).not.toBeInTheDocument();
  });

  it('o treaptă fără `outside_filters` nu primește etichetă', () => {
    renderWithProviders(<ProfileCardView card={card('x', { fallbackTier: 'relaxed' })} />);
    expect(screen.queryByTestId('profile-card-tier')).not.toBeInTheDocument();
  });
});

function renderDeck() {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SwipeDeck />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function swipeLeft() {
  const element = screen.getByTestId('deck-card');
  fireEvent.pointerDown(element, { clientX: 0, clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(element, { clientX: -200, clientY: 0, pointerId: 1 });
  fireEvent.pointerUp(element, { clientX: -200, clientY: 0, pointerId: 1 });
}

function swipeRight() {
  const element = screen.getByTestId('deck-card');
  fireEvent.pointerDown(element, { clientX: 0, clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(element, { clientX: 200, clientY: 0, pointerId: 1 });
  fireEvent.pointerUp(element, { clientX: 200, clientY: 0, pointerId: 1 });
}

/**
 * Serverul de feed, cu TRECERI (ca `feed_service.get_feed`): în aceeași trecere
 * nu repetă nimic; like-urile exclud definitiv, dislike-urile doar până la
 * capătul trecerii. Când nu mai e nimeni nevăzut, pornește o trecere nouă.
 */
function passServer(all: FeedCard[], batch = 3) {
  const liked = new Set<string>();
  let dislikedInPass = new Set<string>();
  let passes = 1;
  const nextPage = () => {
    let page = all.filter((c) => !liked.has(c.userId) && !dislikedInPass.has(c.userId));
    if (page.length === 0 && dislikedInPass.size > 0) {
      dislikedInPass = new Set();
      passes += 1;
      page = all.filter((c) => !liked.has(c.userId));
    }
    return page.slice(0, batch);
  };
  vi.mocked(fetchFeed).mockImplementation(async () => nextPage());
  vi.mocked(swipe).mockImplementation(async (userId: string, action: string) => {
    if (action === 'dislike') dislikedInPass.add(userId);
    else liked.add(userId);
    return { matched: false };
  });
  return { passes: () => passes, nextPage };
}

describe('deck-ul cu treptele de completare și trecerile', () => {
  it('după ce i-a refuzat pe toți, o ia de la capăt (ordinea serverului), fără ecranul gol', async () => {
    const all = [card('s1'), card('s2'), tier('r1', 'relaxed'), tier('g1', 'other_gender')];
    const server = passServer(all);
    renderDeck();

    const order = ['s1', 's2', 'r1', 'g1', 's1', 's2'];
    for (const [n, id] of order.entries()) {
      expect(await screen.findByText(`Nume-${id}, 25`)).toBeInTheDocument();
      expect(screen.queryByTestId('status-feed-empty')).not.toBeInTheDocument();
      swipeLeft();
      await waitFor(() => expect(swipe).toHaveBeenCalledTimes(n + 1));
    }
    expect(server.passes()).toBe(2);
    // În prima trecere fiecare card a apărut O SINGURĂ DATĂ.
    const firstPass = vi.mocked(swipe).mock.calls.slice(0, 4).map(([u]) => u);
    expect(firstPass).toEqual(['s1', 's2', 'r1', 'g1']);
  });

  it('refuzații revin în trecerea nouă, cei plăcuți nu', async () => {
    passServer([card('a'), card('b'), card('c')]);
    renderDeck();

    await screen.findByText('Nume-a, 25');
    swipeRight();
    await waitFor(() => expect(swipe).toHaveBeenCalledWith('a', 'like'));
    await screen.findByText('Nume-b, 25');
    swipeLeft();
    await waitFor(() => expect(swipe).toHaveBeenCalledWith('b', 'dislike'));
    await screen.findByText('Nume-c, 25');
    swipeLeft();
    await waitFor(() => expect(swipe).toHaveBeenCalledWith('c', 'dislike'));

    // Trecerea nouă: b, apoi c — `a` (like) nu mai apare.
    expect(await screen.findByText('Nume-b, 25')).toBeInTheDocument();
    swipeLeft();
    await waitFor(() => expect(vi.mocked(swipe).mock.calls.filter(([u]) => u === 'b')).toHaveLength(2));
    expect(await screen.findByText('Nume-c, 25')).toBeInTheDocument();
    expect(screen.queryByText('Nume-a, 25')).not.toBeInTheDocument();
  });

  it('ecranul gol apare doar când serverul chiar nu mai are pe nimeni (toți plăcuți)', async () => {
    passServer([card('a'), card('b')]);
    renderDeck();

    for (const id of ['a', 'b']) {
      await screen.findByText(`Nume-${id}, 25`);
      swipeRight();
      await waitFor(() => expect(swipe).toHaveBeenCalledWith(id, 'like'));
    }
    expect(await screen.findByTestId('status-feed-empty')).toBeInTheDocument();
  });

  it('„Caută mai multe" cere din nou serverul și arată ce a găsit', async () => {
    vi.mocked(fetchFeed).mockResolvedValueOnce([]).mockResolvedValue([card('x')]);
    vi.mocked(swipe).mockResolvedValue({ matched: false });
    renderDeck();

    expect(await screen.findByTestId('status-feed-empty')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('deck-reload'));
    expect(await screen.findByText('Nume-x, 25')).toBeInTheDocument();
    expect(screen.queryByTestId('status-feed-empty')).not.toBeInTheDocument();
  });

  it('un lot cerut înainte de un swipe nu readuce cardul swipe-uit între timp', async () => {
    const all = ['1', '2', '3', '4', '5'].map((id) => card(id));
    const server = passServer(all);
    let release: (cards: FeedCard[]) => void = () => {};
    renderDeck();
    await screen.findByText('Nume-1, 25');

    // Lotul următor (cerut după primul swipe) rămâne pe drum…
    vi.mocked(fetchFeed).mockImplementationOnce(
      () => new Promise<FeedCard[]>((resolve) => (release = resolve)),
    );
    swipeLeft();
    await waitFor(() => expect(swipe).toHaveBeenCalledWith('1', 'dislike'));
    await screen.findByText('Nume-2, 25');
    // …serverul îl calculează ÎNAINTE de swipe-ul pe 2 (deci îl conține pe 2)…
    const stale = server.nextPage();
    swipeLeft();
    await waitFor(() => expect(swipe).toHaveBeenCalledWith('2', 'dislike'));
    await screen.findByText('Nume-3, 25');
    // …și ajunge abia acum.
    await act(async () => release(stale));

    swipeLeft();
    await waitFor(() => expect(swipe).toHaveBeenCalledWith('3', 'dislike'));
    expect(await screen.findByText('Nume-4, 25')).toBeInTheDocument();
    expect(vi.mocked(swipe).mock.calls.filter(([u]) => u === '2')).toHaveLength(1);
  });

  it('după undo, cardul revine pe ecran', async () => {
    const swiped = new Set<string>();
    vi.mocked(fetchFeed).mockImplementation(async () =>
      swiped.has('c3') ? [] : [tier('c3', 'second_chance')],
    );
    vi.mocked(swipe).mockImplementation(async (userId: string) => {
      swiped.add(userId);
      return { matched: false };
    });
    vi.mocked(undoSwipe).mockImplementation(async () => {
      swiped.delete('c3');
      return { undone: true, targetUserId: 'c3' };
    });
    renderDeck();

    await screen.findByText('Nume-c3, 25');
    swipeLeft();
    await waitFor(() => expect(swipe).toHaveBeenCalledWith('c3', 'dislike'));

    fireEvent.click(await screen.findByTestId('deck-undo'));
    expect(await screen.findByText('Nume-c3, 25')).toBeInTheDocument();
  });
});
