/**
 * Legătura din notificarea botului „X a publicat o poveste":
 * `/feed?story=<autor>` deschide poveștile autorului peste feed, o singură dată.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Story, UserStories } from '@mobile/features/stories/types';

import { renderWithProviders } from '@/test/harness';
import { resetSeenStories } from '@/features/stories/storySeen';

vi.mock('@/features/stories/storiesApi', () => ({
  fetchStories: vi.fn(),
  fetchMyStories: vi.fn(),
  uploadStoryMedia: vi.fn(),
  createStory: vi.fn(),
  replyToStory: vi.fn(),
  deleteStory: vi.fn(),
}));

const { fetchStories, fetchMyStories } = await import('@/features/stories/storiesApi');
const { StoriesStrip } = await import('../StoriesStrip');

const AUTHOR = '3f2b8c1e-9d4a-4e6b-8a1f-0c2d3e4f5a6b';

const STORY: Story = {
  id: 's1',
  userId: AUTHOR,
  mediaUrl: 'https://cdn.test/1.jpg',
  mediaType: 'image',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};

const GROUPS: UserStories[] = [{ userId: AUTHOR, name: 'Ana', storyCount: 1, stories: [STORY] }];

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderAt(entry: string) {
  return renderWithProviders(
    <MemoryRouter initialEntries={[entry]}>
      <StoriesStrip />
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetSeenStories();
  vi.mocked(fetchStories).mockResolvedValue(GROUPS);
  vi.mocked(fetchMyStories).mockResolvedValue([]);
});

describe('deschiderea poveștilor din notificare', () => {
  it('deschide poveștile autorului și șterge parametrul din adresă', async () => {
    renderAt(`/feed?story=${AUTHOR}`);

    expect(await screen.findByTestId('stories-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('story-media')).toHaveAttribute('src', STORY.mediaUrl);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/feed$/));
  });

  it('după închidere NU se redeschide singură', async () => {
    renderAt(`/feed?story=${AUTHOR}`);
    await userEvent.click(await screen.findByTestId('story-close'));

    await waitFor(() => expect(screen.queryByTestId('stories-overlay')).not.toBeInTheDocument());
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/feed$/);
  });

  it('autor fără povești active → doar feedul, parametrul dispare', async () => {
    renderAt('/feed?story=99999999-9d4a-4e6b-8a1f-0c2d3e4f5a6b');

    await screen.findByTestId(`story-group-${AUTHOR}`);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/feed$/));
    expect(screen.queryByTestId('stories-overlay')).not.toBeInTheDocument();
  });

  it('lista de povești nu se încarcă → feedul rămâne, fără overlay', async () => {
    vi.mocked(fetchStories).mockRejectedValue(new Error('offline'));
    renderAt(`/feed?story=${AUTHOR}`);

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/feed$/));
    expect(screen.queryByTestId('stories-overlay')).not.toBeInTheDocument();
  });

  it('fără parametru nu deschide nimic', async () => {
    renderAt('/feed');
    await screen.findByTestId(`story-group-${AUTHOR}`);
    expect(screen.queryByTestId('stories-overlay')).not.toBeInTheDocument();
  });
});
