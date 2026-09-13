/**
 * Poveștile ÎN CAPUL ecranului de ankete, peste deck-ul de swipe.
 *
 * Testul care contează cel mai mult aici e cel de GESTURI. Cardul ascultă
 * `pointerdown/move/up` pe ambele axe, bara derulează pe orizontală; puse una
 * peste alta, fără o graniță scrisă în cod, rezultatul e o aplicație care pare
 * stricată — cardul sare când vrei să derulezi bara, sau bara nu derulează
 * deloc. Granița e scrisă la ambele capete (`StoriesBar` oprește propagarea,
 * `SwipeDeck` ignoră gesturile pornite în zonă străină), iar testele de mai jos
 * o verifică din ambele direcții.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedCard } from '@mobile/features/feed/types';
import type { Story, UserStories } from '@mobile/features/stories/types';

import '@/i18n';
import { renderWithProviders } from '@/test/harness';
import { resetSeenStories } from '@/features/stories/storySeen';

import { SwipeDeck } from '../SwipeDeck';

vi.mock('@mobile/features/feed/feedApi', () => ({
  fetchFeed: vi.fn(),
  swipe: vi.fn(),
  undoSwipe: vi.fn(),
}));

vi.mock('@/features/stories/storiesApi', () => ({
  fetchStories: vi.fn(),
  fetchMyStories: vi.fn(),
  uploadStoryMedia: vi.fn(),
  createStory: vi.fn(),
  replyToStory: vi.fn(),
  deleteStory: vi.fn(),
}));

const { fetchFeed, swipe } = await import('@mobile/features/feed/feedApi');
const { fetchStories, fetchMyStories } = await import('@/features/stories/storiesApi');

const CARDS: FeedCard[] = [
  {
    userId: 'u1',
    name: 'Ana',
    age: 24,
    gender: 'f',
    city: 'Chișinău',
    about: '',
    topInterests: [],
    languages: ['ro'],
    compatibility: 91,
    photos: [],
  },
  {
    userId: 'u2',
    name: 'Bogdan',
    age: 29,
    gender: 'm',
    city: 'Bălți',
    about: '',
    topInterests: [],
    languages: ['ro'],
    compatibility: 42,
    photos: [],
  },
];

const LATER = new Date(Date.now() + 86_400_000).toISOString();

const ANA_STORY: Story = {
  id: 's1',
  userId: 'u1',
  mediaUrl: 'https://cdn.test/1.jpg',
  mediaType: 'image',
  createdAt: new Date().toISOString(),
  expiresAt: LATER,
};

const GROUPS: UserStories[] = [
  { userId: 'u1', name: 'Ana', storyCount: 1, stories: [ANA_STORY] },
];

/** Un gest complet de pointer pe un element, de la (0,0) la (dx,dy). */
function drag(element: HTMLElement, dx: number, dy: number, pointerId = 1) {
  fireEvent.pointerDown(element, { clientX: 0, clientY: 0, pointerId });
  fireEvent.pointerMove(element, { clientX: dx, clientY: dy, pointerId });
  fireEvent.pointerUp(element, { clientX: dx, clientY: dy, pointerId });
}

beforeEach(() => {
  resetSeenStories();
  vi.mocked(fetchFeed).mockResolvedValue(CARDS);
  vi.mocked(swipe).mockResolvedValue({ matched: false });
  vi.mocked(fetchStories).mockResolvedValue(GROUPS);
  vi.mocked(fetchMyStories).mockResolvedValue([]);
});

/** Randează deck-ul și așteaptă primul card. */
async function renderFeed() {
  renderWithProviders(<SwipeDeck />);
  return await screen.findByTestId('deck-card');
}

describe('bara de povești în capul feedului', () => {
  it('stă deasupra cărților, cu cercul de adăugare primul', async () => {
    const card = await renderFeed();
    const bar = screen.getByTestId('stories-bar');

    expect(screen.getByTestId('stories-add')).toBeInTheDocument();
    // ÎNAINTEA cardului în document, adică sus pe ecran — nu peste el.
    expect(bar.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bar.contains(card)).toBe(false);
  });

  it('rămâne și când nu mai sunt ankete de arătat', async () => {
    vi.mocked(fetchFeed).mockResolvedValue([]);
    renderWithProviders(<SwipeDeck />);

    expect(await screen.findByTestId('deck-reload')).toBeInTheDocument();
    expect(screen.getByTestId('stories-add')).toBeInTheDocument();
  });

  it('o eroare de rețea la încărcarea barei NU rupe feedul', async () => {
    vi.mocked(fetchStories).mockRejectedValue(new Error('offline'));
    const card = await renderFeed();

    await waitFor(() =>
      expect(screen.getByTestId('stories-bar')).toHaveAttribute('data-state', 'error'),
    );
    // Cardul e acolo și gestul merge mai departe: poveștile sunt un plus, nu o
    // condiție pentru ankete.
    expect(screen.getByText('Ana, 24')).toBeInTheDocument();
    drag(card, 220, 0);
    await waitFor(() => expect(swipe).toHaveBeenCalledWith('u1', 'like'));
  });

  it('fără nicio poveste arată doar cercul de adăugare', async () => {
    vi.mocked(fetchStories).mockResolvedValue([]);
    await renderFeed();

    await waitFor(() =>
      expect(screen.getByTestId('stories-bar')).toHaveAttribute('data-state', 'empty'),
    );
    expect(screen.queryByTestId('story-group-u1')).not.toBeInTheDocument();
    expect(screen.getByTestId('stories-add')).toBeInTheDocument();
  });
});

describe('izolarea gesturilor între bară și cărți', () => {
  it('un gest orizontal pe bară NU mișcă niciun card', async () => {
    const card = await renderFeed();
    await screen.findByTestId('story-group-u1');
    const bar = screen.getByTestId('stories-bar');

    drag(bar, 220, 0, 7);
    // Și varianta urâtă: degetul pleacă de pe bară și ajunge PESTE card înainte
    // să se ridice. Cardul nu are voie să preia un gest pe care nu l-a început.
    fireEvent.pointerMove(card, { clientX: 220, clientY: 0, pointerId: 7 });
    fireEvent.pointerUp(card, { clientX: 220, clientY: 0, pointerId: 7 });

    expect(swipe).not.toHaveBeenCalled();
    expect(card.style.transform).toContain('translate(0px, 0px)');
    expect(screen.getByText('Ana, 24')).toBeInTheDocument();
  });

  it('gestul pe bară nu urcă mai departe în pagină', async () => {
    await renderFeed();
    const item = await screen.findByTestId('story-group-u1');
    const higherUp = vi.fn();
    document.body.addEventListener('pointerdown', higherUp);

    fireEvent.pointerDown(item, { clientX: 0, clientY: 0, pointerId: 3 });

    document.body.removeEventListener('pointerdown', higherUp);
    expect(higherUp).not.toHaveBeenCalled();
  });

  it('un gest pe card nu derulează bara', async () => {
    const card = await renderFeed();
    await screen.findByTestId('story-group-u1');
    const bar = screen.getByTestId('stories-bar');
    const reachedBar = vi.fn();
    bar.addEventListener('pointermove', reachedBar);

    drag(card, -220, 0);

    expect(reachedBar).not.toHaveBeenCalled();
    expect(bar.scrollLeft).toBe(0);
    // Iar gestul cardului își face treaba lui, neatins.
    await waitFor(() => expect(swipe).toHaveBeenCalledWith('u1', 'dislike'));
  });

  it('un clic pe un cerc din bară nu declanșează niciun swipe', async () => {
    await renderFeed();

    fireEvent.click(await screen.findByTestId('story-group-u1'));

    expect(await screen.findByTestId('stories-overlay')).toBeInTheDocument();
    expect(swipe).not.toHaveBeenCalled();
  });
});

describe('vizualizarea unei povești', () => {
  it('se deschide peste tot ecranul și se închide înapoi în feed', async () => {
    await renderFeed();

    fireEvent.click(await screen.findByTestId('story-group-u1'));
    const overlay = await screen.findByTestId('stories-overlay');
    expect(overlay).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByTestId('story-media')).toHaveAttribute('src', ANA_STORY.mediaUrl);

    fireEvent.click(screen.getByTestId('story-close'));

    await waitFor(() =>
      expect(screen.queryByTestId('stories-overlay')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('deck-card')).toBeInTheDocument();
  });

  it('la închidere userul se întoarce în ACEEAȘI poziție din teanc', async () => {
    const card = await renderFeed();

    // Un swipe: teancul e acum pe al doilea card.
    drag(card, 220, 0);
    expect(await screen.findByText('Bogdan, 29')).toBeInTheDocument();

    fireEvent.click(await screen.findByTestId('story-group-u1'));
    await screen.findByTestId('story-media');
    fireEvent.click(screen.getByTestId('story-close'));

    await waitFor(() =>
      expect(screen.queryByTestId('stories-overlay')).not.toBeInTheDocument(),
    );
    // NU „Ana, 24": povestea nu are voie să repornească teancul.
    expect(screen.getByText('Bogdan, 29')).toBeInTheDocument();
  });

  it('poziția rezistă și unui refetch de fundal al feedului', async () => {
    // Cazul real: cât timp userul privește povestea, cache-ul feedului expiră și
    // React Query aduce ACELEAȘI carduri într-o listă nouă. Dacă deck-ul s-ar
    // lega de referință, la închidere userul s-ar trezi la primul card.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    // Fiecare cerere întoarce o listă NOUĂ, cu același conținut.
    vi.mocked(fetchFeed).mockImplementation(async () => CARDS.map((c) => ({ ...c })));
    render(<SwipeDeck />, { wrapper });

    const card = await screen.findByTestId('deck-card');
    drag(card, 220, 0);
    expect(await screen.findByText('Bogdan, 29')).toBeInTheDocument();

    fireEvent.click(await screen.findByTestId('story-group-u1'));
    await screen.findByTestId('story-media');
    await act(async () => {
      await client.refetchQueries({ queryKey: ['feed'] });
    });
    fireEvent.click(screen.getByTestId('story-close'));

    expect(await screen.findByText('Bogdan, 29')).toBeInTheDocument();
  });

  it('povestea privită stinge inelul grupului din bară', async () => {
    await renderFeed();

    const group = await screen.findByTestId('story-group-u1');
    expect(group).toHaveAttribute('data-unseen', 'true');

    fireEvent.click(group);
    await screen.findByTestId('story-media');
    fireEvent.click(screen.getByTestId('story-close'));

    await waitFor(() =>
      expect(screen.getByTestId('story-group-u1')).toHaveAttribute('data-unseen', 'false'),
    );
  });

  it('cercul de adăugare deschide crearea, tot peste feed', async () => {
    await renderFeed();

    fireEvent.click(await screen.findByTestId('stories-add'));

    expect(await screen.findByTestId('stories-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('story-file-input')).toBeInTheDocument();
    // Publicarea e blocată cât timp nu e aleasă nicio poză.
    expect(screen.getByTestId('story-publish')).toBeDisabled();
  });
});
