/**
 * Contractul uploadului de atașament: URL-ul corect, multipart cu `file`,
 * `duration_ms`, `caption`, progresul și maparea `kind` / `attachment`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const { api } = await import('@/api/client');
const { uploadAttachment, fetchMessagesPage, fetchChats } = await import('../chatApi');

const RESPONSE = {
  id: 'm9',
  sender_id: 'me',
  body: 'hi',
  was_masked: false,
  is_read: false,
  created_at: '2026-09-01T10:00:00Z',
  kind: 'voice',
  attachment: {
    url: 'https://cdn.test/v.webm',
    mime: 'audio/webm',
    size_bytes: 2048,
    duration_ms: 7000,
    width: null,
    height: null,
  },
};

beforeEach(() => {
  vi.mocked(api.post).mockReset();
  vi.mocked(api.get).mockReset();
});

describe('uploadAttachment', () => {
  it('trimite multipart la /chats/{id}/attachments și raportează progresul', async () => {
    vi.mocked(api.post).mockImplementation(async (_url, _body, config) => {
      config?.onUploadProgress?.({ loaded: 50, total: 100 } as never);
      return { data: RESPONSE } as never;
    });
    const onProgress = vi.fn();
    const file = new File(['abc'], 'voice.webm', { type: 'audio/webm' });

    const msg = await uploadAttachment('c1', file, {
      durationMs: 7000.4,
      caption: '  hi  ',
      onProgress,
    });

    expect(api.post).toHaveBeenCalledTimes(1);
    const [url, body, config] = vi.mocked(api.post).mock.calls[0]!;
    expect(url).toBe('/chats/c1/attachments');
    expect(body).toBeInstanceOf(FormData);
    const form = body as FormData;
    const sent = form.get('file') as File;
    expect(sent).toBeInstanceOf(Blob);
    expect(sent.name).toBe('voice.webm');
    expect(form.get('duration_ms')).toBe('7000');
    expect(form.get('caption')).toBe('hi');
    // Content-Type NU se forțează: browserul pune boundary-ul.
    expect(config?.headers).toBeUndefined();
    expect(onProgress).toHaveBeenCalledWith(0.5);

    expect(msg.kind).toBe('voice');
    expect(msg.attachment).toEqual({
      url: 'https://cdn.test/v.webm',
      mime: 'audio/webm',
      sizeBytes: 2048,
      durationMs: 7000,
      width: null,
      height: null,
    });
  });

  it('omite câmpurile opționale când lipsesc', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { ...RESPONSE, kind: 'image' } } as never);
    await uploadAttachment('c1', new File(['x'], 'p.jpg', { type: 'image/jpeg' }));
    const form = vi.mocked(api.post).mock.calls[0]![1] as FormData;
    expect(form.has('duration_ms')).toBe(false);
    expect(form.has('caption')).toBe(false);
  });
});

describe('compatibilitatea cu mesajele vechi', () => {
  it('mesajele fără kind/attachment sunt text', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: [{ id: 'a', sender_id: 'u', body: 'x', was_masked: false, is_read: true, created_at: '2026-01-01T00:00:00Z' }],
      headers: {},
    } as never);
    const page = await fetchMessagesPage('c1');
    expect(page.items[0]?.kind).toBe('text');
    expect(page.items[0]?.attachment).toBeNull();
  });

  it('lista de dialoguri citește last_message_kind dacă există', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: [
        {
          chat_id: 'c1',
          other_user_id: 'u1',
          other_name: 'Ana',
          last_message: '',
          last_message_kind: 'image',
          unread_count: 0,
          compatibility: 50,
        },
      ],
    } as never);
    const chats = await fetchChats();
    expect(chats[0]?.lastMessageKind).toBe('image');
  });
});
