/**
 * Completarea feedului pe trepte: când potrivirile stricte se termină, serverul
 * umple lotul cu carduri `outside_filters` (`relaxed`, `second_chance`,
 * `other_gender`). Cardul le marchează discret, iar deck-ul nu repetă în aceeași
 * sesiune un card de completare deja swipe-uit.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FallbackTier, FeedCard } from '@mobile/features/feed/types';

import i18n from '@/i18n';
import { createTestQueryClient, renderWithProviders } from '@/test/harness';

import { ProfileCardView } from '../ProfileCardView';
import { resetSessionSwipes, SwipeDeck } from '../SwipeDeck';

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
  resetSessionSwipes();
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

describe('deck-ul cu treptele de completare', () => {
  it('trece de la potriviri stricte la completare, apoi la ecranul gol', async () => {
    // Serverul: întâi strictele, apoi treptele; exclude ce s-a swipe-uit, MAI PUȚIN
    // `second_chance`, pe care îl readuce mereu (cel mai rău caz pentru client).
    const all = [card('s1'), card('s2'), tier('r1', 'relaxed'), tier('c1', 'second_chance'), tier('g1', 'other_gender')];
    const swiped = new Set<string>();
    vi.mocked(fetchFeed).mockImplementation(async () =>
      all.filter((c) => c.fallbackTier === 'second_chance' || !swiped.has(c.userId)).slice(0, 3),
    );
    vi.mocked(swipe).mockImplementation(async (userId: string) => {
      swiped.add(userId);
      return { matched: false };
    });
    renderDeck();

    for (const id of ['s1', 's2', 'r1', 'c1', 'g1']) {
      expect(await screen.findByText(`Nume-${id}, 25`)).toBeInTheDocument();
      swipeLeft();
      await waitFor(() => expect(swipe).toHaveBeenCalledWith(id, 'dislike'));
    }

    // Cardul „încă o șansă" refuzat nu revine, deși serverul îl tot trimite.
    expect(await screen.findByTestId('status-feed-empty')).toBeInTheDocument();
    expect(vi.mocked(swipe).mock.calls.filter(([id]) => id === 'c1')).toHaveLength(1);
  });

  it('un card „încă o șansă" refuzat nu revine nici la „Caută mai multe", nici la un deck nou', async () => {
    vi.mocked(fetchFeed).mockImplementation(async () => [tier('c2', 'second_chance')]);
    vi.mocked(swipe).mockResolvedValue({ matched: false });
    const { unmount } = renderDeck();

    await screen.findByText('Nume-c2, 25');
    swipeLeft();
    await waitFor(() => expect(swipe).toHaveBeenCalledWith('c2', 'dislike'));
    expect(await screen.findByTestId('status-feed-empty')).toBeInTheDocument();

    // „Caută mai multe" pornește deck-ul de la primul card al listei noi.
    const calls = vi.mocked(fetchFeed).mock.calls.length;
    fireEvent.click(screen.getByTestId('deck-reload'));
    await waitFor(() => expect(vi.mocked(fetchFeed).mock.calls.length).toBeGreaterThan(calls));
    expect(await screen.findByTestId('status-feed-empty')).toBeInTheDocument();
    expect(screen.queryByText('Nume-c2, 25')).not.toBeInTheDocument();

    // Tab schimbat și revenit (deck nou, cache nou): tot nu revine în sesiune.
    unmount();
    renderDeck();
    expect(await screen.findByTestId('status-feed-empty')).toBeInTheDocument();
    expect(screen.queryByText('Nume-c2, 25')).not.toBeInTheDocument();
  });

  it('după undo, cardul de completare poate reveni din server', async () => {
    vi.mocked(fetchFeed).mockImplementation(async () => [tier('c3', 'second_chance')]);
    vi.mocked(swipe).mockResolvedValue({ matched: false });
    vi.mocked(undoSwipe).mockResolvedValue({ undone: true, targetUserId: 'c3' });
    const { unmount } = renderDeck();

    await screen.findByText('Nume-c3, 25');
    swipeLeft();
    await waitFor(() => expect(swipe).toHaveBeenCalledWith('c3', 'dislike'));

    fireEvent.click(await screen.findByTestId('deck-undo'));
    expect(await screen.findByText('Nume-c3, 25')).toBeInTheDocument();

    // Un deck nou îl arată din nou: undo l-a scos din lista sesiunii.
    unmount();
    renderDeck();
    expect(await screen.findByText('Nume-c3, 25')).toBeInTheDocument();
  });
});
