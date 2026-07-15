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

// Permisiune de cameră controlabilă între teste (variabile prefixate cu `mock`).
let mockCamPerm: { granted: boolean; canAskAgain: boolean } | null = {
  granted: true,
  canAskAgain: true,
};
const mockRequestCamPerm = jest.fn(async () => mockCamPerm);
// Ultimele props primite de `CameraView` (ca să verificăm flip-ul).
const mockCameraProps: { current: Record<string, unknown> | null } = { current: null };

jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    CameraView: React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      mockCameraProps.current = props;
      React.useImperativeHandle(ref, () => ({
        takePictureAsync: jest.fn(),
        recordAsync: jest.fn(),
        stopRecording: jest.fn(),
      }));
      // Randăm un host node cu testID ca query-urile să găsească „camera".
      return React.createElement(View, { testID: props.testID });
    }),
    useCameraPermissions: () => [mockCamPerm, mockRequestCamPerm],
    useMicrophonePermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
  };
});

// Dialoguri: le neutralizăm (nu apar ferestre native în teste).
const mockAlert = jest.fn();
jest.mock('@/utils/dialog', () => ({
  alertMessage: (...args: unknown[]) => mockAlert(...args),
  confirmAsync: jest.fn(async () => false),
}));

// Selectorul de media din galerie.
const mockPick = jest.fn();
jest.mock('@/features/stories/storyPicker', () => ({
  pickStoryMedia: () => mockPick(),
  openAppSettings: jest.fn(),
}));

// Captura live (poză/clip) — controlăm rezultatul.
const mockCapture = jest.fn();
const mockRecord = jest.fn();
jest.mock('@/features/stories/storyCamera', () => ({
  captureStoryPhoto: (...args: unknown[]) => mockCapture(...args),
  recordStoryVideo: (...args: unknown[]) => mockRecord(...args),
}));

// API: spionăm upload-ul + crearea.
const mockUpload = jest.fn();
const mockCreate = jest.fn();
jest.mock('@/features/stories/storiesApi', () => ({
  uploadStoryMedia: (...args: unknown[]) => mockUpload(...args),
  createStory: (...args: unknown[]) => mockCreate(...args),
}));

const SHOT_IMAGE = {
  uri: 'file:///shot.jpg',
  mimeType: 'image/jpeg',
  fileName: 'shot.jpg',
  mediaType: 'image' as const,
};

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
    mockCamPerm = { granted: true, canAskAgain: true };
    mockCameraProps.current = null;
    mockRequestCamPerm.mockClear();
    mockPick.mockReset();
    mockCapture.mockReset();
    mockRecord.mockReset();
    mockUpload.mockReset();
    mockCreate.mockReset();
    mockAlert.mockReset();
    mockBack.mockClear();
  });

  it('se deschide pe camera LIVE, cu buton de captură, flip și galerie', () => {
    const { getByTestId, queryByText } = renderScreen();
    expect(getByTestId('story-camera')).toBeTruthy();
    expect(getByTestId('story-capture')).toBeTruthy();
    expect(getByTestId('story-flip')).toBeTruthy();
    expect(getByTestId('story-gallery')).toBeTruthy();
    // NU cere URL / texte de tip „vine curând" (Guideline 2.1).
    expect(queryByText(/curând/i)).toBeNull();
    expect(queryByText(/stub/i)).toBeNull();
  });

  it('cameră frontală implicită; flip-ul comută pe spate', () => {
    const { getByTestId } = renderScreen();
    expect(mockCameraProps.current?.facing).toBe('front');
    fireEvent.press(getByTestId('story-flip'));
    expect(mockCameraProps.current?.facing).toBe('back');
  });

  it('captură → compunere → publică: upload + createStory', async () => {
    mockCapture.mockResolvedValue({ status: 'captured', file: SHOT_IMAGE });
    mockUpload.mockResolvedValue({ mediaUrl: 'https://cdn/x.jpg', mediaType: 'image' });
    mockCreate.mockResolvedValue(CREATED);

    const { getByTestId } = renderScreen();

    fireEvent.press(getByTestId('story-capture'));
    await waitFor(() => expect(getByTestId('story-preview')).toBeTruthy());

    fireEvent.press(getByTestId('story-submit'));

    await waitFor(() => expect(mockUpload).toHaveBeenCalled());
    expect(mockUpload.mock.calls[0][0]).toEqual(SHOT_IMAGE);
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith('https://cdn/x.jpg', 'image', undefined),
    );
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it('o captură eșuată afișează eroarea, fără să treacă la compunere', async () => {
    mockCapture.mockResolvedValue({ status: 'rejected', message: 'Nu am putut face poza.' });

    const { getByTestId, queryByTestId } = renderScreen();
    fireEvent.press(getByTestId('story-capture'));

    await waitFor(() => expect(getByTestId('story-camera-error')).toBeTruthy());
    expect(queryByTestId('story-preview')).toBeNull();
  });

  it('alegere din galerie → compunere', async () => {
    mockPick.mockResolvedValue({ status: 'picked', file: PICKED_IMAGE });

    const { getByTestId } = renderScreen();
    fireEvent.press(getByTestId('story-gallery'));

    await waitFor(() => expect(getByTestId('story-preview')).toBeTruthy());
  });

  it('galerie respinsă local → mesaj clar prin dialog (fără crash)', async () => {
    mockPick.mockResolvedValue({ status: 'rejected', message: 'Clipul e prea mare.' });

    const { getByTestId, queryByTestId } = renderScreen();
    fireEvent.press(getByTestId('story-gallery'));

    await waitFor(() => expect(mockAlert).toHaveBeenCalledWith('Media respinsă', 'Clipul e prea mare.'));
    expect(queryByTestId('story-preview')).toBeNull();
  });

  it('permisiune de cameră refuzată: nu ecran mort — buton de permitere + galerie', async () => {
    mockCamPerm = { granted: false, canAskAgain: true };

    const { getByTestId, queryByTestId } = renderScreen();
    // Fără cameră vizibilă, dar cu căi de recuperare.
    expect(queryByTestId('story-camera')).toBeNull();
    expect(getByTestId('story-grant')).toBeTruthy();
    expect(getByTestId('story-gallery')).toBeTruthy();

    fireEvent.press(getByTestId('story-grant'));
    expect(mockRequestCamPerm).toHaveBeenCalled();
  });

  it('permisiune blocată definitiv: oferă „Deschide setările" + galerie', () => {
    mockCamPerm = { granted: false, canAskAgain: false };

    const { getByTestId, queryByTestId } = renderScreen();
    expect(getByTestId('story-settings')).toBeTruthy();
    expect(getByTestId('story-gallery')).toBeTruthy();
    expect(queryByTestId('story-grant')).toBeNull();
  });

  it('descrierea cu marcaje HTML blochează publicarea', async () => {
    mockCapture.mockResolvedValue({ status: 'captured', file: SHOT_IMAGE });

    const { getByTestId, getByText } = renderScreen();

    fireEvent.press(getByTestId('story-capture'));
    await waitFor(() => expect(getByTestId('story-preview')).toBeTruthy());

    fireEvent.changeText(getByTestId('story-caption'), '<script>alert(1)</script>');
    fireEvent.press(getByTestId('story-submit'));

    expect(getByText('Textul nu poate conține marcaje HTML.')).toBeTruthy();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('„Refă" revine la cameră după o captură', async () => {
    mockCapture.mockResolvedValue({ status: 'captured', file: SHOT_IMAGE });

    const { getByTestId, queryByTestId } = renderScreen();

    fireEvent.press(getByTestId('story-capture'));
    await waitFor(() => expect(getByTestId('story-preview')).toBeTruthy());

    fireEvent.press(getByTestId('story-retake'));
    await waitFor(() => expect(getByTestId('story-camera')).toBeTruthy());
    expect(queryByTestId('story-preview')).toBeNull();
  });
});
