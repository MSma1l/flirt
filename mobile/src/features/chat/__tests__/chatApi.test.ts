import { fetchChats, fetchMessages, markRead, sendMessage } from '../chatApi';

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
      },
    ]);
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
