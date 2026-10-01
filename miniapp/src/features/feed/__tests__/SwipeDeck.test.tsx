import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedCard } from '@mobile/features/feed/types';

import { MemoryRouter } from 'react-router';
import { renderWithProviders } from '@/test/harness';

import { SwipeDeck } from '../SwipeDeck';

// Logica de rețea e REUTILIZATĂ din aplicația Expo; aici testăm gestul și
// deciziile deck-ului, deci mock-uim modulul reutilizat.
vi.mock('@mobile/features/feed/feedApi', () => ({
  fetchFeed: vi.fn(),
  swipe: vi.fn(),
  undoSwipe: vi.fn(),
}));

// Bara de povești din capul feedului își aduce singură datele. Aici NU ea e
// subiectul (are testele ei, în `features/stories` și în `feedStories.test.tsx`),
// dar nemocată ar porni cereri reale din fiecare test de deck.
vi.mock('@/features/stories/storiesApi', () => ({
  fetchStories: vi.fn(async () => []),
  fetchMyStories: vi.fn(async () => []),
  uploadStoryMedia: vi.fn(),
  createStory: vi.fn(),
  replyToStory: vi.fn(),
  deleteStory: vi.fn(),
}));

// Interesele vin de la server ca SLUG-uri; etichetele traduse vin din catalogul
// de referință, ca în profil și în setări. Mock-uim doar cererea catalogului.
vi.mock('@/features/profile/profileApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/profile/profileApi')>();
  return { ...actual, fetchReference: vi.fn() };
});

const { fetchFeed, swipe, undoSwipe } = await import('@mobile/features/feed/feedApi');
const { fetchReference } = await import('@/features/profile/profileApi');

const REFERENCE = {
  genders: [],
  datingStatuses: [],
  languages: [],
  interests: [
    { slug: 'hiking', label: 'drumeții' },
    { slug: 'music', label: 'muzică' },
    { slug: 'movies', label: 'film' },
    { slug: 'coffee', label: 'cafea' },
    { slug: 'animals', label: 'animale' },
  ],
};

const CARDS: FeedCard[] = [
  {
    userId: 'u1',
    name: 'Ana',
    age: 24,
    gender: 'f',
    city: 'Chișinău',
    distanceKm: 3.4,
    about: 'Îmi place drumețiile.',
    topInterests: ['hiking', 'music', 'movies', 'coffee'],
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
    photos: ['https://example.test/b.jpg'],
  },
];

/** Un gest complet de pointer, de la (0,0) la (dx,dy). */
function drag(element: HTMLElement, dx: number, dy: number) {
  fireEvent.pointerDown(element, { clientX: 0, clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(element, { clientX: dx, clientY: dy, pointerId: 1 });
  fireEvent.pointerUp(element, { clientX: dx, clientY: dy, pointerId: 1 });
}

async function renderDeck() {
  renderWithProviders(<MemoryRouter><SwipeDeck /></MemoryRouter>);
  return await screen.findByTestId('deck-card');
}

beforeEach(() => {
  vi.mocked(fetchFeed).mockResolvedValue(CARDS);
  vi.mocked(swipe).mockResolvedValue({ matched: false });
  vi.mocked(undoSwipe).mockResolvedValue({ undone: true, targetUserId: 'u1' });
  vi.mocked(fetchReference).mockResolvedValue(REFERENCE);
  // Indiciul de gesturi apare o singură dată; fiecare test pornește de la zero.
  window.localStorage.clear();
});

describe('stările deck-ului', () => {
  it('arată încărcarea, apoi primul card', async () => {
    renderWithProviders(<MemoryRouter><SwipeDeck /></MemoryRouter>);
    expect(screen.getByRole('status')).toBeInTheDocument();

    expect(await screen.findByText('Ana, 24')).toBeInTheDocument();
    // Maximum 3 interese pe card, ca pe nativ.
    expect(await screen.findByText('drumeții')).toBeInTheDocument();
    expect(screen.queryByText('cafea')).not.toBeInTheDocument();
  });

  it('arată eroarea de feed și permite reîncercarea', async () => {
    vi.mocked(fetchFeed).mockRejectedValueOnce(new Error('offline'));
    renderWithProviders(<MemoryRouter><SwipeDeck /></MemoryRouter>);

    const retry = await screen.findByRole('button', { name: 'Încearcă din nou' });
    vi.mocked(fetchFeed).mockResolvedValue(CARDS);
    fireEvent.click(retry);

    expect(await screen.findByText('Ana, 24')).toBeInTheDocument();
  });

  it('arată starea goală când feed-ul e gol', async () => {
    vi.mocked(fetchFeed).mockResolvedValue([]);
    renderWithProviders(<MemoryRouter><SwipeDeck /></MemoryRouter>);

    expect(await screen.findByTestId('deck-reload')).toBeInTheDocument();
    // Fără swipe-uri în sesiune, butonul de undo nu are ce anula.
    expect(screen.queryByTestId('deck-undo')).not.toBeInTheDocument();
    // Feed gol NU e o eroare: ecranul are logo, titlu și o cale înainte.
    expect(screen.getByTestId('brand-logo')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('eroarea de feed are logo și buton de reîncercare', async () => {
    vi.mocked(fetchFeed).mockRejectedValue(new Error('offline'));
    renderWithProviders(<MemoryRouter><SwipeDeck /></MemoryRouter>);

    expect(await screen.findByTestId('deck-retry')).toBeInTheDocument();
    expect(screen.getByTestId('brand-logo')).toBeInTheDocument();
  });
});

describe('gesturi cu pointer', () => {
  it('dreapta = like și trece la cardul următor', async () => {
    const card = await renderDeck();

    drag(card, 200, 0);

    await waitFor(() => expect(swipe).toHaveBeenCalledWith('u1', 'like'));
    expect(await screen.findByText('Bogdan, 29')).toBeInTheDocument();
  });

  it('stânga = dislike', async () => {
    const card = await renderDeck();

    drag(card, -200, 0);

    await waitFor(() => expect(swipe).toHaveBeenCalledWith('u1', 'dislike'));
  });

  it('sus = super like', async () => {
    const card = await renderDeck();

    drag(card, 0, -200);

    await waitFor(() => expect(swipe).toHaveBeenCalledWith('u1', 'super_like'));
  });

  it('un gest prea scurt nu declanșează nimic', async () => {
    const card = await renderDeck();

    drag(card, 60, 0);

    expect(swipe).not.toHaveBeenCalled();
    expect(screen.getByText('Ana, 24')).toBeInTheDocument();
  });

  it('un gest diagonal e ignorat: nu ghicim intenția', async () => {
    const card = await renderDeck();

    drag(card, 150, 150);

    expect(swipe).not.toHaveBeenCalled();
  });

  it('anularea gestului (pointercancel) readuce cardul, fără acțiune', async () => {
    const card = await renderDeck();

    fireEvent.pointerDown(card, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(card, { clientX: 200, clientY: 0, pointerId: 1 });
    fireEvent.pointerCancel(card, { clientX: 200, clientY: 0, pointerId: 1 });

    expect(swipe).not.toHaveBeenCalled();
    expect(card.style.transform).toContain('translate(0px, 0px)');
  });

  it('mișcarea degetului aduce cardul cu el', async () => {
    const card = await renderDeck();

    fireEvent.pointerDown(card, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(card, { clientX: 80, clientY: 10, pointerId: 1 });

    expect(card.style.transform).toContain('translate(80px, 10px)');
  });

  it('jos = undo, după cel puțin un swipe', async () => {
    const card = await renderDeck();

    drag(card, 200, 0);
    await waitFor(() => expect(swipe).toHaveBeenCalledOnce());

    const next = screen.getByTestId('deck-card');
    drag(next, 0, 200);

    await waitFor(() => expect(undoSwipe).toHaveBeenCalledOnce());
    expect(await screen.findByText('Ana, 24')).toBeInTheDocument();
  });
});

describe('erori de acțiune', () => {
  it('păstrează cardul și anunță utilizatorul când swipe-ul eșuează', async () => {
    vi.mocked(swipe).mockRejectedValueOnce(new Error('offline'));
    const card = await renderDeck();

    drag(card, 200, 0);

    expect(await screen.findByTestId('deck-action-error')).toHaveTextContent(
      'Nu am putut trimite. Încearcă din nou.',
    );
    // Indexul NU avansează: utilizatorul poate reîncerca aceeași alegere.
    expect(screen.getByText('Ana, 24')).toBeInTheDocument();
  });

  it('spune de ce, când serverul REFUZĂ anularea', async () => {
    // `backend/app/services/feed_service.py::undo_last_swipe` nu aruncă: dacă nu
    // găsește niciun `Like` al userului, răspunde 200 cu `undone: false`. Fără
    // ramura asta, utilizatorul apăsa „Anulează", cardul nu revenea și pe ecran
    // nu apărea nimic.
    const card = await renderDeck();
    drag(card, 200, 0);
    await waitFor(() => expect(swipe).toHaveBeenCalledOnce());

    vi.mocked(undoSwipe).mockResolvedValueOnce({ undone: false, targetUserId: null });
    drag(screen.getByTestId('deck-card'), 0, 200);

    expect(await screen.findByTestId('deck-action-error')).toHaveTextContent(
      'Nu mai e nimic de anulat: serverul nu are niciun swipe al tău.',
    );
    // Cardul curent rămâne cel de după swipe — nu ne prefacem că s-a întors.
    expect(screen.getByText('Bogdan, 29')).toBeInTheDocument();
  });

  it('un refuz al anulării oprește și butonul de undo din starea goală', async () => {
    vi.mocked(fetchFeed).mockResolvedValue([CARDS[0] as FeedCard]);
    const card = await renderDeck();
    drag(card, 200, 0);
    await waitFor(() => expect(swipe).toHaveBeenCalledOnce());

    // Feed epuizat → ecranul gol, cu butonul „Înapoi".
    const undoButton = await screen.findByTestId('deck-undo');
    vi.mocked(undoSwipe).mockResolvedValueOnce({ undone: false, targetUserId: null });
    fireEvent.click(undoButton);

    expect(await screen.findByTestId('deck-action-error')).toBeInTheDocument();
    // Serverul a spus că nu are ce anula: butonul dispare, nu rămâne unul mort.
    await waitFor(() => expect(screen.queryByTestId('deck-undo')).not.toBeInTheDocument());
  });

  it('anunță eșecul unui undo', async () => {
    const card = await renderDeck();
    drag(card, 200, 0);
    await waitFor(() => expect(swipe).toHaveBeenCalledOnce());

    vi.mocked(undoSwipe).mockRejectedValueOnce(new Error('offline'));
    drag(screen.getByTestId('deck-card'), 0, 200);

    expect(await screen.findByTestId('deck-action-error')).toHaveTextContent(
      'Nu am putut anula. Încearcă din nou.',
    );
  });
});

describe('match', () => {
  it('arată fereastra de match când serverul confirmă', async () => {
    vi.mocked(swipe).mockResolvedValueOnce({ matched: true, matchId: 'm1', chatId: 'c1' });
    const card = await renderDeck();

    drag(card, 200, 0);

    expect(await screen.findByRole('dialog')).toHaveTextContent('Aveți match!');
    fireEvent.click(screen.getByRole('button', { name: 'Continuă' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('interesele de pe card', () => {
  it('arată etichetele TRADUSE, nu cheile brute de la server', async () => {
    await renderDeck();

    const chips = await screen.findByTestId('profile-card-interests');
    expect(chips).toHaveTextContent('drumeții');
    expect(chips).toHaveTextContent('muzică');
    expect(chips).toHaveTextContent('film');
    // Cheile brute (exact defectul reclamat: „animals", „cars"...) nu apar.
    for (const slug of ['hiking', 'music', 'movies']) {
      expect(screen.queryByText(slug)).not.toBeInTheDocument();
    }
    expect(fetchReference).toHaveBeenCalledWith('ro');
  });

  it('fără catalog nu afișează nicio cheie brută', async () => {
    vi.mocked(fetchReference).mockRejectedValue(new Error('offline'));
    await renderDeck();

    await waitFor(() => expect(fetchReference).toHaveBeenCalled());
    expect(screen.queryByText('hiking')).not.toBeInTheDocument();
    expect(screen.queryByTestId('profile-card-interests')).not.toBeInTheDocument();
  });

  it('o cheie necunoscută catalogului e sărită, nu afișată brut', async () => {
    vi.mocked(fetchFeed).mockResolvedValue([
      { ...(CARDS[0] as FeedCard), topInterests: ['cars', 'animals'] },
    ]);
    await renderDeck();

    const chips = await screen.findByTestId('profile-card-interests');
    expect(chips).toHaveTextContent('animale');
    expect(chips).not.toHaveTextContent('cars');
  });
});

describe('badge-ul de compatibilitate', () => {
  it('are eticheta accesibilă tradusă, nu cheia', async () => {
    await renderDeck();

    const badge = screen.getByTestId('compat-badge');
    expect(badge).toHaveTextContent('91%');
    expect(badge.getAttribute('aria-label')).not.toContain('compat.');
    expect(badge.getAttribute('aria-label')).toContain('91%');
  });
});

describe('pozele cardului', () => {
  const MULTI: FeedCard = {
    ...(CARDS[1] as FeedCard),
    photos: ['https://example.test/1.jpg', 'https://example.test/2.jpg', 'https://example.test/3.jpg'],
  };

  function tap(element: HTMLElement, x: number) {
    fireEvent.pointerDown(element, { clientX: x, clientY: 100, pointerId: 2 });
    fireEvent.pointerUp(element, { clientX: x, clientY: 100, pointerId: 2 });
  }

  it('atingerea în dreapta/stânga comută poza, fără niciun swipe', async () => {
    vi.mocked(fetchFeed).mockResolvedValue([MULTI]);
    const card = await renderDeck();
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 400, bottom: 700, width: 400, height: 700, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    const photo = () => screen.getByTestId('profile-card-photo');
    expect(photo()).toHaveAttribute('src', 'https://example.test/1.jpg');
    expect(screen.getByTestId('photo-pager')).toHaveAccessibleName('Poza 1 din 3');

    tap(card, 300);
    expect(photo()).toHaveAttribute('src', 'https://example.test/2.jpg');
    tap(card, 300);
    expect(photo()).toHaveAttribute('src', 'https://example.test/3.jpg');
    // La ultima poză, încă o atingere în dreapta nu iese din listă.
    tap(card, 300);
    expect(photo()).toHaveAttribute('src', 'https://example.test/3.jpg');
    tap(card, 50);
    expect(photo()).toHaveAttribute('src', 'https://example.test/2.jpg');

    expect(swipe).not.toHaveBeenCalled();
  });

  it('un swipe adevărat NU comută poza', async () => {
    vi.mocked(fetchFeed).mockResolvedValue([MULTI, CARDS[0] as FeedCard]);
    const card = await renderDeck();

    drag(card, 200, 0);

    await waitFor(() => expect(swipe).toHaveBeenCalledWith('u2', 'like'));
  });

  it('se comută și de la tastatură', async () => {
    vi.mocked(fetchFeed).mockResolvedValue([MULTI]);
    await renderDeck();

    fireEvent.click(screen.getByTestId('photo-next'));
    expect(screen.getByTestId('profile-card-photo')).toHaveAttribute(
      'src',
      'https://example.test/2.jpg',
    );
    fireEvent.click(screen.getByTestId('photo-prev'));
    expect(screen.getByTestId('profile-card-photo')).toHaveAttribute(
      'src',
      'https://example.test/1.jpg',
    );
  });

  it('cu o singură poză nu arată indicatoare', async () => {
    await renderDeck();
    expect(screen.queryByTestId('photo-pager')).not.toBeInTheDocument();
  });
});

describe('indiciul de gesturi', () => {
  it('rămâne descrierea cardului pentru cititoarele de ecran', async () => {
    await renderDeck();
    expect(screen.getByTestId('profile-card')).toHaveAccessibleDescription(
      'Trage cardul: stânga = nu, dreapta = like, sus = super like, jos = înapoi.',
    );
  });

  it('apare o singură dată: după „Am înțeles" nu mai revine', async () => {
    const first = renderWithProviders(<MemoryRouter><SwipeDeck /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('feed-gesture-hint-dismiss'));
    expect(screen.queryByTestId('feed-gesture-hint')).not.toBeInTheDocument();
    first.unmount();

    await renderDeck();
    expect(screen.queryByTestId('feed-gesture-hint')).not.toBeInTheDocument();
  });

  it('dispare după primul swipe', async () => {
    const card = await renderDeck();
    expect(screen.getByTestId('feed-gesture-hint')).toBeInTheDocument();

    drag(card, 200, 0);

    await waitFor(() =>
      expect(screen.queryByTestId('feed-gesture-hint')).not.toBeInTheDocument(),
    );
  });
});
