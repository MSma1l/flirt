import {
  fetchAdConfig,
  fetchNextAd,
  reportAdClick,
  reportAdImpression,
} from '../adsApi';

jest.mock('@/services/api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/services/api');

describe('fetchAdConfig', () => {
  beforeEach(() => jest.clearAllMocks());

  it('mapează snake_case → camelCase', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: { enabled: true, swipes_before_ad: 20, max_video_seconds: 8 },
    });

    const cfg = await fetchAdConfig();

    expect(api.get).toHaveBeenCalledWith('/ads/config');
    expect(cfg).toEqual({ enabled: true, swipesBeforeAd: 20, maxVideoSeconds: 8 });
  });

  it('cade pe implicitele din TZ când valorile lipsesc sau sunt invalide', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: { enabled: false, swipes_before_ad: 0, max_video_seconds: -3 },
    });

    const cfg = await fetchAdConfig();
    expect(cfg).toEqual({ enabled: false, swipesBeforeAd: 15, maxVideoSeconds: 10 });
  });

  it('tolerează un body gol', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: undefined });
    const cfg = await fetchAdConfig();
    expect(cfg).toEqual({ enabled: false, swipesBeforeAd: 15, maxVideoSeconds: 10 });
  });
});

describe('fetchNextAd', () => {
  beforeEach(() => jest.clearAllMocks());

  it('mapează reclama snake_case → camelCase', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      status: 200,
      data: {
        id: 7,
        title: 'Super ofertă',
        video_url: 'https://x/ad.mp4',
        image_url: null,
        duration_seconds: 12,
      },
    });

    const ad = await fetchNextAd();

    expect(api.get).toHaveBeenCalledWith('/ads/next');
    expect(ad).toEqual({
      id: 7,
      title: 'Super ofertă',
      videoUrl: 'https://x/ad.mp4',
      imageUrl: null,
      durationSeconds: 12,
    });
  });

  it('întoarce null la 204 No Content', async () => {
    (api.get as jest.Mock).mockResolvedValue({ status: 204, data: '' });
    const ad = await fetchNextAd();
    expect(ad).toBeNull();
  });

  it('întoarce null când body-ul e gol', async () => {
    (api.get as jest.Mock).mockResolvedValue({ status: 200, data: null });
    const ad = await fetchNextAd();
    expect(ad).toBeNull();
  });

  it('mapează video_url/image_url absente la null', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      status: 200,
      data: { id: 3, title: 'Banner', duration_seconds: 5 },
    });

    const ad = await fetchNextAd();
    expect(ad).toEqual({
      id: 3,
      title: 'Banner',
      videoUrl: null,
      imageUrl: null,
      durationSeconds: 5,
    });
  });
});

describe('reportAdImpression', () => {
  beforeEach(() => jest.clearAllMocks());

  it('face POST pe /ads/{id}/impression fără body', async () => {
    (api.post as jest.Mock).mockResolvedValue({ status: 204 });
    await reportAdImpression(42);
    expect(api.post).toHaveBeenCalledWith('/ads/42/impression');
  });

  it('înghite erorile (best-effort, nu aruncă)', async () => {
    (api.post as jest.Mock).mockRejectedValue(new Error('network'));
    await expect(reportAdImpression(7)).resolves.toBeUndefined();
  });
});

describe('reportAdClick', () => {
  beforeEach(() => jest.clearAllMocks());

  it('face POST pe /ads/{id}/click fără body', async () => {
    (api.post as jest.Mock).mockResolvedValue({ status: 204 });
    await reportAdClick(42);
    expect(api.post).toHaveBeenCalledWith('/ads/42/click');
  });

  it('înghite erorile (best-effort, nu aruncă)', async () => {
    (api.post as jest.Mock).mockRejectedValue(new Error('network'));
    await expect(reportAdClick(9)).resolves.toBeUndefined();
  });
});
