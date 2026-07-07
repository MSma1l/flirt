import { fetchChats, fetchMessages, markRead, reactToMessage, sendMessage } from '../chatApi';

jest.mock('@/services/api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/services/api');

describe('fetchChats', () => {
  beforeEach(() => jest.clearAllMocks());

  it('mapează snake_case → camelCase', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [
        {
          chat_id: 'c1',
          other_user_id: 'u2',
          other_name: 'Ana',
          other_age: 24,
          other_city: 'Chișinău',
          last_message: 'Salut!',
          last_message_at: '2026-07-06T10:00:00Z',
          unread_count: 3,
          compatibility: 87,
        },
      ],
    });

    const chats = await fetchChats();

    expect(api.get).toHaveBeenCalledWith('/chats/');
    expect(chats).toEqual([
      {
        chatId: 'c1',
        otherUserId: 'u2',
        otherName: 'Ana',
        otherAge: 24,
        otherCity: 'Chișinău',
        lastMessage: 'Salut!',
        lastMessageAt: '2026-07-06T10:00:00Z',
        unreadCount: 3,
        compatibility: 87,
      },
    ]);
  });

  it('tolerează câmpuri lipsă și listă goală', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [
        {
          chat_id: 'c2',
          other_user_id: 'u3',
          other_name: 'Ion',
          unread_count: 0,
        },
      ],
    });

    const chats = await fetchChats();
    expect(chats[0].otherAge).toBeUndefined();
    expect(chats[0].otherCity).toBeUndefined();
    expect(chats[0].lastMessage).toBeUndefined();
    expect(chats[0].lastMessageAt).toBeUndefined();
    expect(chats[0].unreadCount).toBe(0);
    // Compatibilitatea lipsă devine 0.
    expect(chats[0].compatibility).toBe(0);
  });
});

describe('fetchMessages', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cheamă endpoint-ul corect și mapează snake_case → camelCase', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [
        {
          id: 'm1',
          sender_id: 'u2',
          body: 'Bună!',
          was_masked: true,
          is_read: false,
          created_at: '2026-07-06T10:00:00Z',
          reaction: '❤️',
        },
      ],
    });

    const messages = await fetchMessages('c1');

    expect(api.get).toHaveBeenCalledWith('/chats/c1/messages');
    expect(messages).toEqual([
      {
        id: 'm1',
        senderId: 'u2',
        body: 'Bună!',
        wasMasked: true,
        isRead: false,
        createdAt: '2026-07-06T10:00:00Z',
        reaction: '❤️',
      },
    ]);
  });

  it('mapează reacția lipsă la null', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [
        {
          id: 'm2',
          sender_id: 'u2',
          body: 'Fără reacție',
          was_masked: false,
          is_read: true,
          created_at: '2026-07-06T10:00:00Z',
        },
      ],
    });

    const messages = await fetchMessages('c1');
    expect(messages[0].reaction).toBeNull();
  });
});

describe('sendMessage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('trimite payload corect și mapează răspunsul', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: {
        id: 'm9',
        sender_id: 'me',
        body: 'Hey',
        was_masked: false,
        is_read: false,
        created_at: '2026-07-06T11:00:00Z',
      },
    });

    const msg = await sendMessage('c1', 'Hey');

    expect(api.post).toHaveBeenCalledTimes(1);
    const [url, payload] = (api.post as jest.Mock).mock.calls[0];
    expect(url).toBe('/chats/c1/messages');
    expect(payload).toEqual({ body: 'Hey' });
    expect(msg).toEqual({
      id: 'm9',
      senderId: 'me',
      body: 'Hey',
      wasMasked: false,
      isRead: false,
      createdAt: '2026-07-06T11:00:00Z',
      reaction: null,
    });
  });
});

describe('markRead', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cheamă endpoint-ul de citire', async () => {
    (api.post as jest.Mock).mockResolvedValue({ status: 204 });
    await markRead('c1');
    expect(api.post).toHaveBeenCalledWith('/chats/c1/read');
  });
});

describe('reactToMessage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('trimite reacția la endpoint-ul corect și mapează răspunsul', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: {
        id: 'm1',
        sender_id: 'u2',
        body: 'Bună!',
        was_masked: false,
        is_read: true,
        created_at: '2026-07-06T10:00:00Z',
        reaction: '🔥',
      },
    });

    const msg = await reactToMessage('c1', 'm1', '🔥');

    expect(api.post).toHaveBeenCalledTimes(1);
    const [url, payload] = (api.post as jest.Mock).mock.calls[0];
    expect(url).toBe('/chats/c1/messages/m1/react');
    expect(payload).toEqual({ reaction: '🔥' });
    expect(msg.reaction).toBe('🔥');
  });

  it('trimite null pentru a scoate reacția', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: {
        id: 'm1',
        sender_id: 'u2',
        body: 'Bună!',
        was_masked: false,
        is_read: true,
        created_at: '2026-07-06T10:00:00Z',
        reaction: null,
      },
    });

    const msg = await reactToMessage('c1', 'm1', null);

    const [url, payload] = (api.post as jest.Mock).mock.calls[0];
    expect(url).toBe('/chats/c1/messages/m1/react');
    expect(payload).toEqual({ reaction: null });
    expect(msg.reaction).toBeNull();
  });
});
