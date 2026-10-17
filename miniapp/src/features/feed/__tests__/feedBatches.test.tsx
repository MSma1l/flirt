/**
 * Regresie: „nu se arată anketa" — feedul se oprea după PRIMUL lot.
 *
 * `GET /feed/` întoarce un lot de 10 (`feed_limit`) și exclude pe server tot ce
 * userul a swipe-uit deja. Deck-ul cerea un singur lot, deci după al zecelea
 * swipe toți userii vedeau „Nu mai sunt ankete acum", deși serverul mai avea
 * candidați. Aici serverul e simulat exact așa: loturi de 10, fără cei swipe-uiți.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedCard } from '@mobile/features/feed/types';

import { createTestQueryClient } from '@/test/harness';

import { freshCards, placeInNewList, SwipeDeck } from '../SwipeDeck';

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
  return { ...actual, fetchReference: vi.fn(async () => ({ genders: [], datingStatuses: [], languages: [], interests: [] })) };
});

const { fetchFeed, swipe } = await import('@mobile/features/feed/feedApi');

const BATCH = 10;

function card(n: number): FeedCard {
  return {
    userId: `u${n}`,
    name: `Persoana${n}`,
    age: 20 + (n % 20),
    gender: 'f',
    city: 'Chișinău',
    about: '',
    topInterests: [],
    languages: ['ro'],
    compatibility: 50,
    photos: [],
  };
}

/** Serverul de feed: loturi de `BATCH`, fără cei deja swipe-uiți. */
function fakeServer(total: number) {
  const candidates = Array.from({ length: total }, (_, i) => card(i + 1));
  const swiped = new Set<string>();
  vi.mocked(fetchFeed).mockImplementation(async () =>
    candidates.filter((c) => !swiped.has(c.userId)).slice(0, BATCH),
  );
  vi.mocked(swipe).mockImplementation(async (userId: string) => {
    swiped.add(userId);
    return { matched: false };
  });
  return { candidates };
}

function renderDeck() {
  const client = createTestQueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SwipeDeck />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

function swipeLeft() {
  const element = screen.getByTestId('deck-card');
  fireEvent.pointerDown(element, { clientX: 0, clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(element, { clientX: -200, clientY: 0, pointerId: 1 });
  fireEvent.pointerUp(element, { clientX: -200, clientY: 0, pointerId: 1 });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('feedul trece de primul lot', () => {
  it('15 candidați în 2 loturi: userul îi swipe-uiește pe toți fără ecranul gol', async () => {
    fakeServer(15);
    renderDeck();

    for (let n = 1; n <= 15; n += 1) {
      expect(await screen.findByText(`Persoana${n}, ${20 + (n % 20)}`)).toBeInTheDocument();
      expect(screen.queryByTestId('status-feed-empty')).not.toBeInTheDocument();
      swipeLeft();
      await waitFor(() => expect(swipe).toHaveBeenCalledWith(`u${n}`, 'dislike'));
    }

    // Abia acum serverul nu mai are pe nimeni: ecranul gol e adevărul.
    expect(await screen.findByTestId('status-feed-empty')).toBeInTheDocument();
    expect(swipe).toHaveBeenCalledTimes(15);
  });

  it('ecranul gol apare doar după ce serverul nu mai aduce nimic nou', async () => {
    fakeServer(3);
    renderDeck();

    for (let n = 1; n <= 3; n += 1) {
      await screen.findByText(`Persoana${n}, ${20 + (n % 20)}`);
      swipeLeft();
      await waitFor(() => expect(swipe).toHaveBeenCalledWith(`u${n}`, 'dislike'));
    }

    expect(await screen.findByTestId('status-feed-empty')).toBeInTheDocument();
    // Serverul a fost întrebat din nou înainte de verdictul „nu mai sunt".
    expect(vi.mocked(fetchFeed).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('o listă reîmprospătată după epuizare arată cardurile noi, de la primul', async () => {
    const { candidates } = fakeServer(2);
    const client = renderDeck();

    for (let n = 1; n <= 2; n += 1) {
      await screen.findByText(`Persoana${n}, ${20 + (n % 20)}`);
      swipeLeft();
      await waitFor(() => expect(swipe).toHaveBeenCalledWith(`u${n}`, 'dislike'));
    }
    expect(await screen.findByTestId('status-feed-empty')).toBeInTheDocument();

    // Apar candidați noi (ex. userul a lărgit filtrele în Setări, care
    // invalidează `['feed']`).
    candidates.push(card(3), card(4));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['feed'] });
    });

    expect(await screen.findByText('Persoana3, 23')).toBeInTheDocument();
    expect(screen.queryByTestId('status-feed-empty')).not.toBeInTheDocument();
  });
});

describe('placeInNewList', () => {
  const a = card(1);
  const b = card(2);
  const c = card(3);

  it('se ține de cardul curent', () => {
    expect(placeInNewList([a, b], 1, [b, c])).toBe(0);
  });

  it('după epuizare, o listă proaspătă pornește de la primul card nevăzut', () => {
    expect(placeInNewList([a, b], 2, [c])).toBe(0);
  });

  it('după epuizare, un lot lipit la coadă continuă cu primul card nou', () => {
    expect(placeInNewList([a, b], 2, [a, b, c])).toBe(2);
  });

  it('nimic nou → rămâne la capăt', () => {
    expect(placeInNewList([a, b], 2, [a, b])).toBe(2);
  });
});

describe('freshCards', () => {
  it('scoate cardurile deja în listă și dublurile din pagină', () => {
    expect(freshCards([card(1), card(2)], [card(2), card(3), card(3)]).map((x) => x.userId)).toEqual([
      'u3',
    ]);
  });
});
