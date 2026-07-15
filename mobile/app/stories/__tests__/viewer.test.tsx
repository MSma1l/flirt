import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import StoryViewerScreen from '../[userId]';
import { ThemeProvider } from '@theme/index';
import type { UserStories } from '@/features/stories/types';

// Mock router + parametru de rută.
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ userId: 'u1' }),
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
}));

// Id-ul utilizatorului curent — controlabil (proprietar vs. vizitator).
const mockAuth = { userId: 'me' };
jest.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) =>
    selector({ user: { id: mockAuth.userId } }),
}));

// Mock la storiesApi: sursă controlată + spionăm ștergerea.
const groups: UserStories[] = [
  {
    userId: 'u1',
    name: 'Ana',
    storyCount: 2,
    stories: [
      {
        id: 's1',
        userId: 'u1',
        mediaUrl: 'https://x/1.jpg',
        mediaType: 'image',
        caption: 'Prima poveste',
        createdAt: '2026-07-01T10:00:00Z',
        expiresAt: '2026-07-02T10:00:00Z',
      },
      {
        id: 's2',
        userId: 'u1',
        mediaUrl: 'https://x/2.mp4',
        mediaType: 'video',
        caption: 'A doua poveste',
        createdAt: '2026-07-01T11:00:00Z',
        expiresAt: '2026-07-02T11:00:00Z',
      },
    ],
  },
];
const mockFetchStories = jest.fn<Promise<UserStories[]>, []>(() => Promise.resolve(groups));
const mockDeleteStory = jest.fn((_id: string) => Promise.resolve());
jest.mock('@/features/stories/storiesApi', () => ({
  fetchStories: () => mockFetchStories(),
  deleteStory: (id: string) => mockDeleteStory(id),
}));

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // Sursa vizualizatorului este cache-ul din bara de stories.
  client.setQueryData(['stories'], groups);
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <StoryViewerScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('StoryViewerScreen', () => {
  beforeEach(() => {
    mockFetchStories.mockClear();
    mockDeleteStory.mockClear();
    mockBack.mockClear();
    mockAuth.userId = 'me';
  });

  it('tap dreapta avansează la povestea următoare', () => {
    const { getByText, getByLabelText } = renderScreen();

    expect(getByText('Prima poveste')).toBeTruthy();
    fireEvent.press(getByLabelText('Povestea următoare'));
    expect(getByText('A doua poveste')).toBeTruthy();
  });

  it('povestea video afișează media de tip video (nu imagine)', () => {
    const { getByTestId, queryByTestId, getByLabelText } = renderScreen();

    // Prima e imagine.
    expect(getByTestId('story-image')).toBeTruthy();

    // A doua e video → placeholder nativ de video, fără <Image>.
    fireEvent.press(getByLabelText('Povestea următoare'));
    expect(getByTestId('story-video-fallback')).toBeTruthy();
    expect(queryByTestId('story-image')).toBeNull();
  });

  it('proprietarul poate șterge povestea (deleteStory)', async () => {
    mockAuth.userId = 'u1';
    const { getByLabelText } = renderScreen();

    fireEvent.press(getByLabelText('Șterge povestea'));

    await waitFor(() => expect(mockDeleteStory).toHaveBeenCalledWith('s1'));
  });
});
