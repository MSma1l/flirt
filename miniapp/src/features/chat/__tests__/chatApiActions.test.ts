/**
 * Contractul acțiunilor pe mesaj: răspuns (`reply_to_id`), editare (PATCH),
 * ștergere (DELETE) și maparea câmpurilor noi din `MessageOut` / `ChatSummary`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const { api } = await import('@/api/client');
const { sendMessage, editMessage, deleteMessage, uploadAttachment, fetchMessagesPage, fetchChats } =
  await import('../chatApi');

const BASE = {
  id: 'm2',
  sender_id: 'me',
  body: 'Bună',
  was_masked: false,
  is_read: false,
  created_at: '2026-09-01T10:00:00Z',
  kind: 'text',
  attachment: null,
};

beforeEach(() => {
  for (const fn of [api.get, api.post, api.patch, api.delete]) vi.mocked(fn).mockReset();
});

describe('sendMessage', () => {
  it('fără răspuns trimite doar `{body}`', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: BASE } as never);
    await sendMessage('c1', 'Bună');
    expect(api.post).toHaveBeenCalledWith('/chats/c1/messages', { body: 'Bună' });
  });

  it('cu răspuns adaugă `reply_to_id` și mapează citatul', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: {
        ...BASE,
        reply_to: { id: 'm1', sender_id: 'u1', body: 'Salut', kind: 'text', is_deleted: false },
      },
    } as never);
    const msg = await sendMessage('c1', 'Bună', 'm1');
    expect(api.post).toHaveBeenCalledWith('/chats/c1/messages', { body: 'Bună', reply_to_id: 'm1' });
    expect(msg.replyTo).toEqual({
      id: 'm1',
      senderId: 'u1',
      body: 'Salut',
      kind: 'text',
      isDeleted: false,
    });
  });
});

describe('editMessage / deleteMessage', () => {
  it('PATCH cu `{body}` și mapează `edited_at`', async () => {
    vi.mocked(api.patch).mockResolvedValue({
      data: { ...BASE, body: 'Bună seara', edited_at: '2026-09-01T10:05:00Z' },
    } as never);
    const msg = await editMessage('c1', 'm2', 'Bună seara');
    expect(api.patch).toHaveBeenCalledWith('/chats/c1/messages/m2', { body: 'Bună seara' });
    expect(msg.body).toBe('Bună seara');
    expect(msg.editedAt).toBe('2026-09-01T10:05:00Z');
    expect(msg.isDeleted).toBe(false);
  });

  it('DELETE întoarce forma ștearsă, fără reacție și atașament', async () => {
    vi.mocked(api.delete).mockResolvedValue({
      data: {
        ...BASE,
        body: '',
        is_deleted: true,
        reaction: '❤️',
        kind: 'image',
        attachment: { url: 'https://cdn.test/x.jpg', mime: 'image/jpeg', size_bytes: 1 },
      },
    } as never);
    const msg = await deleteMessage('c1', 'm2');
    expect(api.delete).toHaveBeenCalledWith('/chats/c1/messages/m2');
    expect(msg.isDeleted).toBe(true);
    expect(msg.reaction).toBeNull();
    expect(msg.attachment).toBeNull();
  });
});

describe('câmpurile noi', () => {
  it('uploadul trimite `reply_to_id` în multipart', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: BASE } as never);
    await uploadAttachment('c1', new Blob(['x'], { type: 'audio/webm' }), {
      fileName: 'v.webm',
      replyToId: 'm1',
    });
    const form = vi.mocked(api.post).mock.calls[0]![1] as FormData;
    expect(form.get('reply_to_id')).toBe('m1');
  });

  it('mesajele vechi (fără câmpurile noi) rămân valide', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [BASE], headers: {} } as never);
    const page = await fetchMessagesPage('c1');
    expect(page.items[0]).toMatchObject({ editedAt: null, isDeleted: false, replyTo: null });
  });

  it('lista: `last_message_deleted` ajunge în rând', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: [
        {
          chat_id: 'c1',
          other_user_id: 'u1',
          other_name: 'Ana',
          last_message: '',
          last_message_at: '2026-09-01T10:00:00Z',
          last_message_deleted: true,
          unread_count: 0,
        },
      ],
    } as never);
    const [row] = await fetchChats();
    expect(row?.lastMessageDeleted).toBe(true);
  });
});
