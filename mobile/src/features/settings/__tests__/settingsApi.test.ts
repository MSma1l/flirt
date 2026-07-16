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
  // Preferințele de căutare — `SettingsOut` le întoarce mereu.
  interested_in: ['female'],
  age_min: 21,
  age_max: 35,
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
  interestedIn: ['female'],
  ageMin: 21,
  ageMax: 35,
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

  it('trimite preferințele de căutare în snake_case (filtrele dure ale feed-ului)', async () => {
    (api.put as jest.Mock).mockResolvedValue({ data: RAW_SETTINGS });

    await updateSettings({ interestedIn: ['male', 'other'], ageMin: 25, ageMax: 40 });

    const [, payload] = (api.put as jest.Mock).mock.calls[0];
    expect(payload).toEqual({
      interested_in: ['male', 'other'],
      age_min: 25,
      age_max: 40,
    });
  });

  it('lista goală de genuri se trimite (= fără restricție), nu se omite ca `undefined`', async () => {
    (api.put as jest.Mock).mockResolvedValue({ data: RAW_SETTINGS });

    await updateSettings({ interestedIn: [] });

    const [, payload] = (api.put as jest.Mock).mock.calls[0];
    expect(payload).toEqual({ interested_in: [] });
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

  it('cheamă /social/blocks cu limit și mapează snake_case → camelCase', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [
        { blocked_id: 'u1', name: 'Ana' },
        { blocked_id: 'u2', name: 'Ion' },
      ],
      headers: {},
    });

    const page = await fetchBlocks();

    // Prima pagină: `limit` da, `cursor` nu.
    expect(api.get).toHaveBeenCalledWith('/social/blocks', { params: { limit: 20 } });
    expect(page.items).toEqual([
      { blockedId: 'u1', name: 'Ana' },
      { blockedId: 'u2', name: 'Ion' },
    ]);
  });

  it('citește cursorul paginii următoare din header-ul X-Next-Cursor', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [{ blocked_id: 'u1', name: 'Ana' }],
      headers: { 'x-next-cursor': 'CURSOR2' },
    });

    expect((await fetchBlocks()).nextCursor).toBe('CURSOR2');
  });

  it('fără header X-Next-Cursor → nextCursor null (ultima pagină)', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [], headers: {} });
    expect((await fetchBlocks()).nextCursor).toBeNull();
  });

  it('trimite cursorul primit înapoi la backend', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [], headers: {} });

    await fetchBlocks({ cursor: 'CURSOR2', limit: 5 });

    expect(api.get).toHaveBeenCalledWith('/social/blocks', {
      params: { limit: 5, cursor: 'CURSOR2' },
    });
  });

  it('tolerează listă goală/absentă', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: null, headers: {} });
    expect(await fetchBlocks()).toEqual({ items: [], nextCursor: null });
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
