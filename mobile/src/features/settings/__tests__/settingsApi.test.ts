import {
  cancelAccountDeletion,
  fetchBlocks,
  fetchSettings,
  fetchTicket,
  requestAccountDeletion,
  unblock,
  updateSettings,
} from '../settingsApi';

jest.mock('@/services/api', () => ({
  api: {
    get: jest.fn(),
    put: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/services/api');

const RAW_SETTINGS = {
  theme: 'dark',
  search_radius_km: 25,
  notifications: {
    match: true,
    messages: false,
    ai_hints: true,
    events: false,
    promos: true,
  },
  profile_hidden: true,
  region: 'Chișinău',
};

const MAPPED_SETTINGS = {
  theme: 'dark',
  searchRadiusKm: 25,
  notifications: {
    match: true,
    messages: false,
    aiHints: true,
    events: false,
    promos: true,
  },
  profileHidden: true,
  region: 'Chișinău',
};

describe('fetchSettings', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cheamă /settings și mapează snake_case → camelCase', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: RAW_SETTINGS });

    const settings = await fetchSettings();

    expect(api.get).toHaveBeenCalledWith('/settings/');
    expect(settings).toEqual(MAPPED_SETTINGS);
  });
});

describe('updateSettings', () => {
  beforeEach(() => jest.clearAllMocks());

  it('trimite payload snake_case și mapează răspunsul', async () => {
    (api.put as jest.Mock).mockResolvedValue({ data: RAW_SETTINGS });

    const settings = await updateSettings({
      theme: 'dark',
      searchRadiusKm: 25,
      profileHidden: true,
      region: 'Chișinău',
      notifications: { aiHints: true, promos: true },
    });

    expect(api.put).toHaveBeenCalledTimes(1);
    const [url, payload] = (api.put as jest.Mock).mock.calls[0];
    expect(url).toBe('/settings/');
    expect(payload).toEqual({
      theme: 'dark',
      search_radius_km: 25,
      profile_hidden: true,
      region: 'Chișinău',
      notifications: { ai_hints: true, promos: true },
    });
    expect(settings).toEqual(MAPPED_SETTINGS);
  });

  it('omite câmpurile nedefinite din payload', async () => {
    (api.put as jest.Mock).mockResolvedValue({ data: RAW_SETTINGS });

    await updateSettings({ searchRadiusKm: 10 });

    const [, payload] = (api.put as jest.Mock).mock.calls[0];
    expect(payload).toEqual({ search_radius_km: 10 });
    expect(payload).not.toHaveProperty('theme');
    expect(payload).not.toHaveProperty('notifications');
  });
});

describe('requestAccountDeletion', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cheamă endpoint-ul și mapează datele răspunsului', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: { requested_at: '2026-07-07T10:00:00Z', purge_after: '2026-08-06T10:00:00Z' },
    });

    const res = await requestAccountDeletion();

    expect(api.post).toHaveBeenCalledWith('/settings/account/delete');
    expect(res).toEqual({
      requestedAt: '2026-07-07T10:00:00Z',
      purgeAfter: '2026-08-06T10:00:00Z',
    });
  });
});

describe('cancelAccountDeletion', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cheamă endpoint-ul de anulare', async () => {
    (api.post as jest.Mock).mockResolvedValue({ status: 204 });
    await cancelAccountDeletion();
    expect(api.post).toHaveBeenCalledWith('/settings/account/delete/cancel');
  });
});

describe('fetchTicket', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cheamă /ticket și întoarce codul + status', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: { code: 'FP-1234', used: false } });

    const ticket = await fetchTicket();

    expect(api.get).toHaveBeenCalledWith('/ticket/');
    expect(ticket).toEqual({ code: 'FP-1234', used: false });
  });
});

describe('fetchBlocks', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cheamă /social/blocks și mapează snake_case → camelCase', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [
        { blocked_id: 'u1', name: 'Ana' },
        { blocked_id: 'u2', name: 'Ion' },
      ],
    });

    const blocks = await fetchBlocks();

    expect(api.get).toHaveBeenCalledWith('/social/blocks');
    expect(blocks).toEqual([
      { blockedId: 'u1', name: 'Ana' },
      { blockedId: 'u2', name: 'Ion' },
    ]);
  });

  it('tolerează listă goală/absentă', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: null });
    const blocks = await fetchBlocks();
    expect(blocks).toEqual([]);
  });
});

describe('unblock', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cheamă DELETE pe utilizatorul corect', async () => {
    (api.delete as jest.Mock).mockResolvedValue({ status: 204 });
    await unblock('u2');
    expect(api.delete).toHaveBeenCalledWith('/social/blocks/u2');
  });
});
