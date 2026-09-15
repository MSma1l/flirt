/**
 * Refuzul la swipe nu are voie să fie o fundătură.
 *
 * S-a întâmplat în producție, pe utilizatori reali: fiecare like și super like
 * primea 403, aplicația afișa „nu am putut trimite", iar oamenii rămâneau blocați
 * fără să afle ce li se cere. Backendul refuza intenționat — nu completaseră
 * testul de umor — și trimitea un mesaj distinct tocmai ca să fie duși acolo.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedCard } from '@mobile/features/feed/types';

import { MemoryRouter } from 'react-router';
import { renderWithProviders } from '@/test/harness';

import { SwipeDeck } from '../SwipeDeck';
import { clasificaRefuzul } from '../swipeBlock';

vi.mock('@mobile/features/feed/feedApi', () => ({
  fetchFeed: vi.fn(),
  swipe: vi.fn(),
  undoSwipe: vi.fn(),
}));

vi.mock('@/features/stories/storiesApi', () => ({
  fetchStories: vi.fn(async () => []),
  fetchMyStories: vi.fn(async () => []),
  createStory: vi.fn(),
  deleteStory: vi.fn(),
}));

const { fetchFeed, swipe } = await import('@mobile/features/feed/feedApi');

const CARD: FeedCard = {
  userId: 'u1',
  name: 'Ana',
  age: 24,
  gender: 'f',
  city: 'Chișinău',
  distanceKm: 3.4,
  about: 'Îmi place drumețiile.',
  topInterests: ['drumeții', 'muzică'],
  languages: ['ro'],
  compatibility: 91,
  photos: [],
};

function refuz(code: string | undefined, detail: string) {
  return { response: { status: 403, data: code ? { code, detail } : { detail } } };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchFeed).mockResolvedValue([CARD]);
});

/** Un gest complet de pointer spre dreapta = like, exact ca in testele deck-ului. */
async function daLike() {
  renderWithProviders(
    <MemoryRouter>
      <SwipeDeck />
    </MemoryRouter>,
  );
  const card = await screen.findByTestId('deck-card');
  fireEvent.pointerDown(card, { clientX: 0, clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(card, { clientX: 200, clientY: 0, pointerId: 1 });
  fireEvent.pointerUp(card, { clientX: 200, clientY: 0, pointerId: 1 });
}

describe('clasificarea refuzului', () => {
  it('foloseste CODUL stabil, nu textul', () => {
    const b = clasificaRefuzul(refuz('humor_required', 'orice text, in orice limba'));
    expect(b?.kind).toBe('humor');
    expect(b?.to).toBe('/humor');
  });

  it('cade pe text doar cand serverul nu trimite cod', () => {
    const b = clasificaRefuzul(refuz(undefined, 'Completează testul de umor.'));
    expect(b?.kind).toBe('humor');
  });

  it('textul fara diacritice se potriveste la fel', () => {
    const b = clasificaRefuzul(refuz(undefined, 'Completeaza testul de umor.'));
    expect(b?.kind).toBe('humor');
  });

  it('un refuz NECUNOSCUT duce totusi undeva — niciodata fundatura', () => {
    const b = clasificaRefuzul(refuz('ceva_nou_inventat_maine', 'mesaj necunoscut'));
    expect(b).not.toBeNull();
    expect(b?.to).toBeTruthy();
    expect(b?.actionKey).toBeTruthy();
  });

  it('pozele si profilul duc in locuri DIFERITE', () => {
    const poze = clasificaRefuzul(refuz('photos_required', ''));
    const profil = clasificaRefuzul(refuz('profile_incomplete', ''));
    expect(poze?.to).not.toBe(profil?.to);
  });

  it('refuzurile pe care userul nu le poate rezolva nu propun o actiune falsa', () => {
    for (const cod of ['underage', 'interaction_blocked', 'self_swipe']) {
      const b = clasificaRefuzul(refuz(cod, ''));
      expect(b?.to).toBeNull();
      expect(b?.actionKey).toBeNull();
    }
  });

  it('o eroare care NU e refuz de autorizare ramane eroare de reincercat', () => {
    expect(clasificaRefuzul({ response: { status: 500, data: {} } })).toBeNull();
    expect(clasificaRefuzul(new Error('retea cazuta'))).toBeNull();
  });
});

describe('deck-ul cand serverul refuza', () => {
  it('arata panoul cu ACTIUNE, nu mesajul generic de reincercare', async () => {
    vi.mocked(swipe).mockRejectedValue(refuz('humor_required', 'Completează testul de umor.'));

    await daLike();

    await waitFor(() => expect(screen.getByTestId('deck-block')).toBeInTheDocument());
    expect(screen.getByTestId('deck-block-action')).toBeInTheDocument();
    expect(screen.queryByTestId('deck-action-error')).not.toBeInTheDocument();
  });

  it('o eroare de retea ramane mesaj de reincercare, nu panou', async () => {
    vi.mocked(swipe).mockRejectedValue(new Error('retea cazuta'));

    await daLike();

    await waitFor(() => expect(screen.getByTestId('deck-action-error')).toBeInTheDocument());
    expect(screen.queryByTestId('deck-block')).not.toBeInTheDocument();
  });
});
