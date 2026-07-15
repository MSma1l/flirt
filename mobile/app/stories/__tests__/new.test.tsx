import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import NewStoryScreen from '../new';
import { ThemeProvider } from '@theme/index';
import type { Story } from '@/features/stories/types';

// Router + Stack.Screen (evită expo-router real).
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
}));

// Camera: permisiuni acordate, componentă inertă (fără modul nativ în jest).
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
  useMicrophonePermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
}));

// Dialoguri: le neutralizăm (nu apar ferestre native în teste).
jest.mock('@/utils/dialog', () => ({
  alertMessage: jest.fn(),
  confirmAsync: jest.fn(async () => false),
}));

// Selectorul de media din galerie.
const mockPick = jest.fn();
jest.mock('@/features/stories/storyPicker', () => ({
  pickStoryMedia: () => mockPick(),
  openAppSettings: jest.fn(),
}));

// API: spionăm upload-ul + crearea.
const mockUpload = jest.fn();
const mockCreate = jest.fn();
jest.mock('@/features/stories/storiesApi', () => ({
  uploadStoryMedia: (...args: unknown[]) => mockUpload(...args),
  createStory: (...args: unknown[]) => mockCreate(...args),
}));

const PICKED_IMAGE = {
  uri: 'file:///a.jpg',
  mimeType: 'image/jpeg',
  fileName: 'a.jpg',
  mediaType: 'image' as const,
};

const CREATED: Story = {
  id: 's1',
  userId: 'me',
  mediaUrl: 'https://cdn/x.jpg',
  mediaType: 'image',
  createdAt: '2026-07-01T10:00:00Z',
  expiresAt: '2026-07-02T10:00:00Z',
};

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
    mockPick.mockReset();
    mockUpload.mockReset();
    mockCreate.mockReset();
    mockBack.mockClear();
  });

  it('NU cere URL și NU afișează texte de tip „vine curând" (Guideline 2.1)', () => {
    const { queryByText, queryByTestId } = renderScreen();
    expect(queryByText(/curând/i)).toBeNull();
    expect(queryByText(/stub/i)).toBeNull();
    // Câmpul vechi de lipit URL nu mai există.
    expect(queryByTestId('story-media-url')).toBeNull();
  });

  it('oferă sursă din galerie și filmare (nativ)', () => {
    const { getByTestId } = renderScreen();
    expect(getByTestId('story-pick')).toBeTruthy();
    expect(getByTestId('story-open-camera')).toBeTruthy();
  });

  it('fără media aleasă, publicarea nu urcă nimic', () => {
    const { getByTestId } = renderScreen();
    fireEvent.press(getByTestId('story-submit'));
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('alege din galerie, apoi publică: upload + createStory', async () => {
    mockPick.mockResolvedValue({ status: 'picked', file: PICKED_IMAGE });
    mockUpload.mockResolvedValue({ mediaUrl: 'https://cdn/x.jpg', mediaType: 'image' });
    mockCreate.mockResolvedValue(CREATED);

    const { getByTestId } = renderScreen();

    fireEvent.press(getByTestId('story-pick'));
    await waitFor(() => expect(getByTestId('story-preview')).toBeTruthy());

    fireEvent.press(getByTestId('story-submit'));

    await waitFor(() => expect(mockUpload).toHaveBeenCalled());
    expect(mockUpload.mock.calls[0][0]).toEqual(PICKED_IMAGE);
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith('https://cdn/x.jpg', 'image', undefined),
    );
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it('descrierea cu marcaje HTML blochează publicarea', async () => {
    mockPick.mockResolvedValue({ status: 'picked', file: PICKED_IMAGE });

    const { getByTestId, getByText } = renderScreen();

    fireEvent.press(getByTestId('story-pick'));
    await waitFor(() => expect(getByTestId('story-preview')).toBeTruthy());

    fireEvent.changeText(getByTestId('story-caption'), '<script>alert(1)</script>');
    fireEvent.press(getByTestId('story-submit'));

    expect(getByText('Textul nu poate conține marcaje HTML.')).toBeTruthy();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('media respinsă local afișează eroarea', async () => {
    mockPick.mockResolvedValue({ status: 'rejected', message: 'Clipul e prea mare.' });

    const { getByTestId, getByText } = renderScreen();

    fireEvent.press(getByTestId('story-pick'));

    await waitFor(() => expect(getByText('Clipul e prea mare.')).toBeTruthy());
    expect(mockUpload).not.toHaveBeenCalled();
  });
});
