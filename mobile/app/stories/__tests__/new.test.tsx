import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import NewStoryScreen from '../new';
import { ThemeProvider } from '@theme/index';
import type { Story } from '@/features/stories/types';

// Mock router + Stack.Screen (evită expo-router real).
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
}));

// Mock la storiesApi: spionăm crearea.
const createdStory: Story = {
  id: 's1',
  userId: 'me',
  mediaUrl: 'https://x/1.jpg',
  createdAt: '2026-07-01T10:00:00Z',
  expiresAt: '2026-07-02T10:00:00Z',
};
const mockCreateStory = jest.fn((_url: string, _caption?: string) => Promise.resolve(createdStory));
jest.mock('@/features/stories/storiesApi', () => ({
  createStory: (url: string, caption?: string) => mockCreateStory(url, caption),
}));

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <NewStoryScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('NewStoryScreen', () => {
  beforeEach(() => {
    mockCreateStory.mockClear();
    mockBack.mockClear();
  });

  it('URL gol blochează publicarea și arată eroarea', () => {
    const { getByTestId, getByText } = renderScreen();

    fireEvent.press(getByTestId('story-submit'));

    expect(getByText('Adaugă un URL de media.')).toBeTruthy();
    expect(mockCreateStory).not.toHaveBeenCalled();
  });

  it('publică povestea cu URL valid (createStory)', async () => {
    const { getByTestId } = renderScreen();

    fireEvent.changeText(getByTestId('story-media-url'), 'https://x/1.jpg');
    fireEvent.press(getByTestId('story-submit'));

    await waitFor(() => expect(mockCreateStory).toHaveBeenCalledWith('https://x/1.jpg', undefined));
  });
});
