/**
 * Ecranul „Aveți match!" după un swipe reciproc.
 *
 * Testerii: „când e like reciproc, în aplicație nu se arată nicăieri". Apărăm:
 *   - la `matched: true` apare ecranul, cu numele și poza celuilalt;
 *   - „Scrie un mesaj" deschide EXACT conversația creată la match;
 *   - „Continuă să cauți" închide ecranul și lasă userul în deck;
 *   - fără match nu apare nimic.
 */
import { configure, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

import type { FeedCard } from '@mobile/features/feed/types';

import i18n from '@/i18n';
import { renderWithProviders } from '@/test/harness';

import { SwipeDeck } from '../SwipeDeck';

// Deck-ul + catalogul i18n se încarcă la rece; 1s implicit e prea puțin pe o
// mașină încărcată. Aserțiile nu se schimbă.
configure({ asyncUtilTimeout: 10_000 });

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
  return { ...actual, fetchReference: vi.fn(), fetchMyProfile: vi.fn() };
});

const { fetchFeed, swipe } = await import('@mobile/features/feed/feedApi');
const { fetchReference, fetchMyProfile } = await import('@/features/profile/profileApi');

const ANA: FeedCard = {
  userId: 'u1',
  name: 'Ana',
  age: 24,
  gender: 'f',
  city: 'Chișinău',
  distanceKm: 3,
  about: 'Salut',
  topInterests: [],
  languages: ['ro'],
  compatibility: 90,
  photos: ['https://cdn/ana.jpg'],
};
const BOGDAN: FeedCard = { ...ANA, userId: 'u2', name: 'Bogdan', photos: [] };

const tr = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'miniapp', ...opts });

function renderDeck() {
  return renderWithProviders(
    <MemoryRouter initialEntries={['/feed']}>
      <Routes>
        <Route path="/feed" element={<SwipeDeck />} />
        <Route path="/mesaje/:chatId" element={<p data-testid="chat-opened">chat</p>} />
        <Route path="/mesaje" element={<p data-testid="chats-opened">chats</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function likeFirstCard() {
  // Gestul prin pointer: tragere la dreapta peste prag = like.
  const card = await screen.findByTestId('deck-card');
  fireEvent.pointerDown(card, { clientX: 0, clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(card, { clientX: 400, clientY: 0, pointerId: 1 });
  fireEvent.pointerUp(card, { clientX: 400, clientY: 0, pointerId: 1 });
}

beforeEach(() => {
  void i18n.changeLanguage('ro');
  window.localStorage.setItem('flirt.feed.gestureHintSeen', '1');
  vi.mocked(fetchFeed).mockResolvedValue([ANA, BOGDAN]);
  vi.mocked(fetchReference).mockResolvedValue({
    genders: [],
    datingStatuses: [],
    languages: [],
    interests: [],
  });
  vi.mocked(fetchMyProfile).mockResolvedValue({
    name: 'Ion',
    photos: ['https://cdn/ion.jpg'],
  } as never);
});

describe('ecranul de match', () => {
  it('apare după un like reciproc, cu ambele poze și numele celuilalt', async () => {
    vi.mocked(swipe).mockResolvedValueOnce({ matched: true, matchId: 'm1', chatId: 'c1' });
    const { baseElement } = renderDeck();
    await likeFirstCard();

    const dialog = await screen.findByTestId('match-overlay');
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveTextContent(tr('feed.match.title'));
    expect(dialog).toHaveTextContent(tr('feed.match.body', { name: 'Ana' }));
    expect(baseElement.querySelector('img[src="https://cdn/ana.jpg"]')).not.toBeNull();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(baseElement.querySelector('.match-overlay img[src="https://cdn/ion.jpg"]')).not.toBeNull(),
    );
  });

  it('„Scrie un mesaj" deschide conversația creată la match', async () => {
    vi.mocked(swipe).mockResolvedValueOnce({ matched: true, matchId: 'm1', chatId: 'c1' });
    renderDeck();
    await likeFirstCard();

    fireEvent.click(await screen.findByTestId('match-write'));
    expect(await screen.findByTestId('chat-opened')).toBeInTheDocument();
    expect(screen.queryByTestId('match-overlay')).toBeNull();
  });

  it('fără id de conversație, duce la lista de mesaje', async () => {
    vi.mocked(swipe).mockResolvedValueOnce({ matched: true, matchId: 'm1' });
    renderDeck();
    await likeFirstCard();

    fireEvent.click(await screen.findByTestId('match-write'));
    expect(await screen.findByTestId('chats-opened')).toBeInTheDocument();
  });

  it('„Continuă să cauți" închide ecranul și lasă userul la următorul card', async () => {
    vi.mocked(swipe).mockResolvedValueOnce({ matched: true, matchId: 'm1', chatId: 'c1' });
    renderDeck();
    await likeFirstCard();

    fireEvent.click(await screen.findByTestId('match-continue'));
    expect(screen.queryByTestId('match-overlay')).toBeNull();
    expect(await screen.findByText(/Bogdan/)).toBeInTheDocument();
  });

  it('fără match nu apare nimic', async () => {
    vi.mocked(swipe).mockResolvedValueOnce({ matched: false });
    renderDeck();
    await likeFirstCard();

    expect(await screen.findByText(/Bogdan/)).toBeInTheDocument();
    expect(screen.queryByTestId('match-overlay')).toBeNull();
  });
});
