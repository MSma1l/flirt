import { sendReport } from '../reportApi';

jest.mock('@/services/api', () => ({
  api: {
    post: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/services/api');

describe('sendReport', () => {
  beforeEach(() => jest.clearAllMocks());

  it('trimite POST /reports/ cu payload snake_case complet', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: {} });

    await sendReport({
      reportedUserId: 'u2',
      category: 'spam',
      chatId: 'c1',
      note: 'Trimite reclame',
    });

    expect(api.post).toHaveBeenCalledTimes(1);
    const [url, payload] = (api.post as jest.Mock).mock.calls[0];
    expect(url).toBe('/reports/');
    expect(payload).toEqual({
      reported_user_id: 'u2',
      category: 'spam',
      chat_id: 'c1',
      note: 'Trimite reclame',
    });
  });

  it('omite chat_id și note când lipsesc', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: {} });

    await sendReport({ reportedUserId: 'u9', category: 'fake' });

    const [, payload] = (api.post as jest.Mock).mock.calls[0];
    expect(payload).toEqual({ reported_user_id: 'u9', category: 'fake' });
    expect(payload).not.toHaveProperty('chat_id');
    expect(payload).not.toHaveProperty('note');
  });

  it('nu include o notă formată doar din spații', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: {} });

    await sendReport({ reportedUserId: 'u3', category: 'obscene', note: '   ' });

    const [, payload] = (api.post as jest.Mock).mock.calls[0];
    expect(payload).not.toHaveProperty('note');
  });
});
