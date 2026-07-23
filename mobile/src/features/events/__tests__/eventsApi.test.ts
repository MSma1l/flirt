import { checkin, fetchEvent, fetchEvents, fetchPassport, setGoing } from '../eventsApi';

jest.mock('@/services/api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/services/api');

const RAW_EVENT = {
  id: 'e1',
  title: 'Flirt Party Chișinău',
  description: 'Seară de dating live',
  starts_at: '2026-07-10T19:00:00Z',
  city: 'Chișinău',
  venue: 'Club Nova',
  lat: 47.01,
  lng: 28.86,
  kind: 'flirt_party',
  cover_url: 'https://x/cover.jpg',
  attendee_count: 42,
  i_am_going: true,
};

describe('fetchEvents', () => {
  beforeEach(() => jest.clearAllMocks());

  it('mapează snake_case → camelCase', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [RAW_EVENT] });

    const events = await fetchEvents();

    expect(api.get).toHaveBeenCalledWith('/events/');
    expect(events).toEqual([
      {
        id: 'e1',
        title: 'Flirt Party Chișinău',
        description: 'Seară de dating live',
        startsAt: '2026-07-10T19:00:00Z',
        city: 'Chișinău',
        venue: 'Club Nova',
        lat: 47.01,
        lng: 28.86,
        kind: 'flirt_party',
        coverUrl: 'https://x/cover.jpg',
        attendeeCount: 42,
        iAmGoing: true,
        promoDiscountPercent: null,
        promoCode: null,
        promoDescription: null,
        ticketPrice: null,
        ticketCurrency: null,
      },
    ]);
  });

  it('tolerează câmpuri opționale lipsă și listă goală', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [
        {
          id: 'e2',
          title: 'Concert',
          description: '',
          starts_at: '2026-08-01T20:00:00Z',
          city: 'Bălți',
          venue: 'Arena',
          kind: 'concert',
          attendee_count: 0,
          i_am_going: false,
        },
      ],
    });

    const events = await fetchEvents();
    expect(events[0].lat).toBeUndefined();
    expect(events[0].lng).toBeUndefined();
    expect(events[0].coverUrl).toBeUndefined();
    expect(events[0].iAmGoing).toBe(false);
    expect(events[0].promoDiscountPercent).toBeNull();
    expect(events[0].promoCode).toBeNull();
    expect(events[0].promoDescription).toBeNull();
  });

  it('mapează câmpurile de promo când sunt prezente', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [
        {
          ...RAW_EVENT,
          promo_discount_percent: 15,
          promo_code: 'LOVE15',
          promo_description: 'Reducere la intrare.',
        },
      ],
    });

    const events = await fetchEvents();
    expect(events[0].promoDiscountPercent).toBe(15);
    expect(events[0].promoCode).toBe('LOVE15');
    expect(events[0].promoDescription).toBe('Reducere la intrare.');
  });
});

describe('fetchEvent', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cere endpoint-ul cu id și mapează rezultatul', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: RAW_EVENT });

    const event = await fetchEvent('e1');

    expect(api.get).toHaveBeenCalledWith('/events/e1');
    expect(event.attendeeCount).toBe(42);
    expect(event.iAmGoing).toBe(true);
  });
});

describe('setGoing', () => {
  beforeEach(() => jest.clearAllMocks());

  it('trimite payload {going} și mapează evenimentul actualizat', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: { ...RAW_EVENT, i_am_going: false, attendee_count: 41 },
    });

    const event = await setGoing('e1', false);

    expect(api.post).toHaveBeenCalledTimes(1);
    const [url, payload] = (api.post as jest.Mock).mock.calls[0];
    expect(url).toBe('/events/e1/going');
    expect(payload).toEqual({ going: false });
    expect(event.iAmGoing).toBe(false);
    expect(event.attendeeCount).toBe(41);
  });
});

describe('checkin', () => {
  beforeEach(() => jest.clearAllMocks());

  it('face POST la /checkin fără body și mapează ștampila', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: {
        event_id: 'e1',
        event_title: 'Flirt Party Chișinău',
        city: 'Chișinău',
        stamped_at: '2026-07-10T19:30:00Z',
      },
    });

    const stamp = await checkin('e1');

    expect(api.post).toHaveBeenCalledTimes(1);
    const [url] = (api.post as jest.Mock).mock.calls[0];
    expect(url).toBe('/events/e1/checkin');
    expect(stamp).toEqual({
      eventId: 'e1',
      eventTitle: 'Flirt Party Chișinău',
      city: 'Chișinău',
      stampedAt: '2026-07-10T19:30:00Z',
    });
  });
});

describe('fetchPassport', () => {
  beforeEach(() => jest.clearAllMocks());

  it('mapează ștampilele snake_case → camelCase', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [
        {
          event_id: 'e1',
          event_title: 'Flirt Party Chișinău',
          city: 'Chișinău',
          stamped_at: '2026-07-10T19:30:00Z',
        },
      ],
    });

    const stamps = await fetchPassport();

    expect(api.get).toHaveBeenCalledWith('/events/passport');
    expect(stamps).toEqual([
      {
        eventId: 'e1',
        eventTitle: 'Flirt Party Chișinău',
        city: 'Chișinău',
        stampedAt: '2026-07-10T19:30:00Z',
      },
    ]);
  });

  it('întoarce listă goală când data lipsește', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: null });
    const stamps = await fetchPassport();
    expect(stamps).toEqual([]);
  });
});
