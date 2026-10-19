/**
 * Profilul partenerului (deschis din antetul conversației și din avatarul din
 * listă) + playerul vocal cu eroare clară.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/auth/authStore';
import { renderWithProviders } from '@/test/harness';

import type { ChatSummaryEx, PartnerProfile } from '../chatApi';
import { ChatListRow } from '../ChatListRow';
import { ChatScreen } from '../ChatScreen';
import { CHAT_PROFILE_ROUTE_PATTERN, CHAT_ROUTE_PATTERN, chatPath, chatProfilePath } from '../chatRoutes';
import { PartnerProfileScreen } from '../PartnerProfileScreen';
import { VoicePlayer } from '../VoicePlayer';

vi.mock('../chatApi', () => ({
  fetchChats: vi.fn(),
  fetchMessagesPage: vi.fn(),
  fetchPartnerProfile: vi.fn(),
  markRead: vi.fn(),
  reactToMessage: vi.fn(),
  sendMessage: vi.fn(),
  uploadAttachment: vi.fn(),
}));
vi.mock('@mobile/features/moderation/reportApi', () => ({ sendReport: vi.fn() }));
vi.mock('@/features/ai', () => ({ AiAssistBar: () => null }));
vi.mock('@/features/profile/profileApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/profile/profileApi')>()),
  fetchReference: vi.fn(),
}));

const { fetchChats, fetchMessagesPage, fetchPartnerProfile, markRead } = await import('../chatApi');
const { fetchReference } = await import('@/features/profile/profileApi');

const CHAT: ChatSummaryEx = {
  chatId: 'c1',
  otherUserId: 'u1',
  otherName: 'Timur',
  otherAge: 18,
  otherCity: 'Chișinău',
  lastMessage: 'Salut',
  lastMessageAt: new Date().toISOString(),
  unreadCount: 0,
  compatibility: 72,
  otherPhotoUrl: 'https://cdn.test/t1.jpg',
};

const PROFILE: PartnerProfile = {
  userId: 'u1',
  name: 'Timur',
  age: 18,
  gender: 'male',
  city: 'Chișinău',
  heightCm: 182,
  nationality: null,
  languages: ['ru'],
  about: 'Îmi place muzica.',
  datingStatuses: [],
  interests: ['sport', 'travel'],
  photos: ['https://cdn.test/t1.jpg', 'https://cdn.test/t2.jpg'],
  avatarUrl: 'https://cdn.test/t1.jpg',
  verified: true,
  compatibility: 72,
};

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

function renderAt(path: string) {
  return renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={CHAT_ROUTE_PATTERN} element={<ChatScreen />} />
        <Route path={CHAT_PROFILE_ROUTE_PATTERN} element={<PartnerProfileScreen />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuthStore.setState({
    status: 'authenticated',
    user: { id: 'me', email: 'me@test.local', profile_completed: true },
    error: null,
  });
  vi.mocked(fetchChats).mockResolvedValue([CHAT]);
  vi.mocked(fetchMessagesPage).mockResolvedValue({ items: [], nextCursor: null });
  vi.mocked(markRead).mockResolvedValue(undefined);
  vi.mocked(fetchPartnerProfile).mockResolvedValue(PROFILE);
  vi.mocked(fetchReference).mockResolvedValue({
    genders: [{ value: 'male', label: 'Bărbat' }],
    datingStatuses: [],
    languages: [{ value: 'ru', label: 'Rusă' }],
    interests: [
      { slug: 'sport', label: 'Sport' },
      { slug: 'travel', label: 'Călătorii' },
    ],
  } as never);
});

describe('profilul partenerului', () => {
  it('din antetul conversației, avatarul deschide profilul cu toate pozele', async () => {
    renderAt(chatPath('c1'));
    await settle();

    const avatar = await screen.findByTestId('chat-open-profile');
    expect(avatar.querySelector('img')).toHaveAttribute('src', 'https://cdn.test/t1.jpg');
    fireEvent.click(avatar);
    await settle();

    expect(await screen.findByTestId('partner-profile')).toBeInTheDocument();
    expect(fetchPartnerProfile).toHaveBeenCalledWith('c1');
    expect(screen.getAllByTestId('partner-photo')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Timur, 18' })).toBeInTheDocument();
    expect(screen.getByTestId('partner-about')).toHaveTextContent('Îmi place muzica.');
    expect(await screen.findByText('Călătorii')).toBeInTheDocument();
    expect(screen.getByTestId('partner-verified')).toBeInTheDocument();
  });

  it('și numele din antet deschide profilul', async () => {
    renderAt(chatPath('c1'));
    await settle();
    fireEvent.click(await screen.findByTestId('chat-open-profile-name'));
    await settle();
    expect(await screen.findByTestId('partner-profile')).toBeInTheDocument();
  });

  it('galeria trece la poza următoare la atingere', async () => {
    renderAt(chatProfilePath('c1'));
    await settle();

    const photos = await screen.findAllByTestId('partner-photo');
    expect(photos[0]).toHaveClass('pf-hero__img--active');
    fireEvent.click(screen.getByTestId('partner-photo-next'));
    expect(screen.getAllByTestId('partner-photo')[1]).toHaveClass('pf-hero__img--active');
  });

  it('„Scrie un mesaj" duce înapoi în conversație', async () => {
    renderAt(chatProfilePath('c1'));
    await settle();
    fireEvent.click(await screen.findByTestId('partner-write'));
    await settle();
    expect(await screen.findByTestId('chat-open-profile')).toBeInTheDocument();
  });

  it('block / chat străin (403) → mesaj clar, fără reîncercări inutile', async () => {
    vi.mocked(fetchPartnerProfile).mockRejectedValue(
      new AxiosError('forbidden', '403', undefined, undefined, {
        status: 403,
        statusText: 'Forbidden',
        data: {},
        headers: {},
        config: { headers: new AxiosHeaders() },
      }),
    );
    renderAt(chatProfilePath('c1'));
    await settle();

    expect(await screen.findByTestId('partner-error')).toHaveTextContent('Profil indisponibil');
    expect(screen.queryByTestId('partner-retry')).not.toBeInTheDocument();
    expect(fetchPartnerProfile).toHaveBeenCalledTimes(1);
  });

  it('în listă, avatarul e un link spre profil, rândul spre conversație', () => {
    renderWithProviders(
      <MemoryRouter>
        <ul>
          <ChatListRow chat={CHAT} />
        </ul>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('chat-row-avatar')).toHaveAttribute('href', chatProfilePath('c1'));
    expect(screen.getByTestId('chat-row')).toHaveAttribute('href', chatPath('c1'));
    expect(screen.getByTestId('chat-row').querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.test/t1.jpg',
    );
  });
});

describe('playerul vocal', () => {
  it('arată durata, iar la un fișier neredabil afișează o eroare clară', async () => {
    renderWithProviders(<VoicePlayer id="v1" src="https://cdn.test/v.weba" durationMs={7000} own={false} />);

    expect(screen.getByTestId('voice-time')).toHaveTextContent('0:07');
    const audio = document.querySelector('audio') as HTMLAudioElement;
    await act(async () => {
      audio.dispatchEvent(new Event('error'));
    });
    expect(screen.getByTestId('voice-play-error')).toHaveTextContent('nu poate fi redat');
    expect(screen.getByTestId('voice-player')).toHaveAttribute('data-state', 'error');
    expect(screen.getByRole('button', { name: 'Reîncearcă redarea' })).toBeInTheDocument();
  });

  it('play respins de browser (format nesuportat) → eroare, nu buton mort', async () => {
    renderWithProviders(<VoicePlayer id="v2" src="https://cdn.test/v.weba" durationMs={3000} own />);
    const audio = document.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'paused', { configurable: true, get: () => true });
    audio.play = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'NotSupportedError' }));

    fireEvent.click(screen.getByRole('button', { name: 'Ascultă' }));
    await settle();
    expect(screen.getByTestId('voice-play-error')).toBeInTheDocument();
  });
});
