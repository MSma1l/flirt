/**
 * Bara de povești: ce arată, ce apasă utilizatorul și cum se poartă când nu are
 * ce arăta.
 *
 * Regula de aur a barei: ea NU e conținutul ecranului pe care stă. Lipsa
 * poveștilor e normală, iar o rețea căzută la încărcarea ei nu are voie să
 * strice ecranul de dedesubt — de aici testele de „gol" și de „eroare", care
 * verifică exact absența unui mesaj de avarie.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Story, UserStories } from '@mobile/features/stories/types';

import { renderWithProviders } from '@/test/harness';

import { StoriesBar } from '../StoriesBar';
import { markStorySeen, resetSeenStories } from '../storySeen';

vi.mock('../storiesApi', () => ({
  fetchStories: vi.fn(),
  fetchMyStories: vi.fn(),
  uploadStoryMedia: vi.fn(),
  createStory: vi.fn(),
  replyToStory: vi.fn(),
  deleteStory: vi.fn(),
}));

const { fetchStories } = await import('../storiesApi');

const LATER = new Date(Date.now() + 86_400_000).toISOString();

function story(id: string, userId: string): Story {
  return {
    id,
    userId,
    mediaUrl: `https://cdn.test/${id}.jpg`,
    mediaType: 'image',
    createdAt: new Date().toISOString(),
    expiresAt: LATER,
  };
}

const ANA_1 = story('s1', 'u1');
const ANA_2 = story('s2', 'u1');
const BOGDAN_1 = story('s3', 'u2');

const GROUPS: UserStories[] = [
  { userId: 'u1', name: 'Ana', storyCount: 2, stories: [ANA_1, ANA_2] },
  { userId: 'u2', name: 'Bogdan', storyCount: 1, stories: [BOGDAN_1] },
];

beforeEach(() => {
  resetSeenStories();
  vi.mocked(fetchStories).mockResolvedValue(GROUPS);
});

function renderBar(onOpenGroup = vi.fn(), onAdd = vi.fn()) {
  renderWithProviders(<StoriesBar onOpenGroup={onOpenGroup} onAdd={onAdd} variant="feed" />);
  return { onOpenGroup, onAdd };
}

describe('bara de povești', () => {
  it('pune cercul de adăugare PRIMUL, apoi poveștile celorlalți', async () => {
    renderBar();

    await screen.findByTestId('story-group-u1');
    const items = screen.getAllByRole('button');
    expect(items[0]).toHaveAttribute('data-testid', 'stories-add');
    expect(items[1]).toHaveAttribute('data-testid', 'story-group-u1');
    expect(items[2]).toHaveAttribute('data-testid', 'story-group-u2');
  });

  it('cercul de adăugare cheamă crearea, cercul unui grup îl deschide', async () => {
    const { onAdd, onOpenGroup } = renderBar();

    fireEvent.click(await screen.findByTestId('stories-add'));
    expect(onAdd).toHaveBeenCalledOnce();

    fireEvent.click(await screen.findByTestId('story-group-u2'));
    expect(onOpenGroup).toHaveBeenCalledWith('u2');
  });

  it('distinge poveștile nevăzute de cele văzute', async () => {
    renderBar();

    // La prima vedere, ambele grupuri sunt nevăzute.
    expect(await screen.findByTestId('story-group-u1')).toHaveAttribute('data-unseen', 'true');
    expect(screen.getByTestId('story-group-u2')).toHaveAttribute('data-unseen', 'true');

    // O SINGURĂ poveste din două nu stinge grupul: mai are ceva nevăzut.
    act(() => markStorySeen(ANA_1));
    expect(screen.getByTestId('story-group-u1')).toHaveAttribute('data-unseen', 'true');

    act(() => markStorySeen(ANA_2));
    expect(screen.getByTestId('story-group-u1')).toHaveAttribute('data-unseen', 'false');
    // Inelul stins e o clasă distinctă, nu doar un atribut de test.
    expect(screen.getByTestId('story-group-u1').querySelector('.st-bar__ring')).toHaveClass(
      'st-bar__ring--seen',
    );
    // Celălalt grup nu e atins de ce a văzut userul la Ana.
    expect(screen.getByTestId('story-group-u2')).toHaveAttribute('data-unseen', 'true');
  });

  it('fără nicio poveste arată DOAR cercul de adăugare, fără mesaj de eroare', async () => {
    vi.mocked(fetchStories).mockResolvedValue([]);
    renderBar();

    const bar = await screen.findByTestId('stories-bar');
    await waitFor(() => expect(bar).toHaveAttribute('data-state', 'empty'));
    expect(screen.getByTestId('stories-add')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByText(/eroare|Nu am putut/i)).not.toBeInTheDocument();
  });

  it('o rețea căzută lasă bara funcțională, fără să anunțe o avarie', async () => {
    vi.mocked(fetchStories).mockRejectedValue(new Error('offline'));
    renderBar();

    const bar = await screen.findByTestId('stories-bar');
    await waitFor(() => expect(bar).toHaveAttribute('data-state', 'error'));
    // Cercul de adăugare rămâne: userul își poate publica povestea chiar dacă
    // lista celorlalți n-a venit.
    expect(screen.getByTestId('stories-add')).toBeInTheDocument();
    expect(screen.queryByTestId('stories-error')).not.toBeInTheDocument();
  });

  it('își marchează zona de gesturi, ca deck-ul să o poată ocoli', async () => {
    renderBar();

    expect(await screen.findByTestId('stories-bar')).toHaveAttribute(
      'data-gesture-zone',
      'stories',
    );
  });
});
