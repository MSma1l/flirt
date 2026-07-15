/**
 * Contractul push-ului REAL. Ce apărăm aici, mai presus de orice: aplicația NU
 * trimite niciodată la backend un token pe care nu l-a primit efectiv de la Expo.
 * Un token fals „merge" din perspectiva codului și tace din perspectiva userului.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  __resetPushCacheForTests,
  ensureAndroidChannel,
  requestPushPermissionAndRegister,
  syncPushRegistration,
  unregisterDevice,
} from '../pushService';

// Dispozitiv fizic vs. simulator — comutabil per test (getter: valoarea e citită
// la momentul apelului, nu la construirea mock-ului).
let mockIsDevice = true;
jest.mock('expo-device', () => ({
  get isDevice() {
    return mockIsDevice;
  },
}));

// projectId-ul EAS: `null` reproduce EXACT starea de azi a proiectului (fără cont EAS).
let mockProjectId: string | null = 'proiect-eas-de-test';
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: mockProjectId ? { eas: { projectId: mockProjectId } } : {} };
    },
    easConfig: null,
  },
}));

jest.mock('@/services/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/services/api');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useAuthStore } = require('@/store/authStore');

const perms = Notifications.getPermissionsAsync as jest.Mock;
const requestPerms = Notifications.requestPermissionsAsync as jest.Mock;
const getToken = Notifications.getExpoPushTokenAsync as jest.Mock;
const setChannel = Notifications.setNotificationChannelAsync as jest.Mock;

const REAL_TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';

/** Permisiune deja acordată (cazul „userul a spus da"). */
function granted() {
  perms.mockResolvedValue({ granted: true, canAskAgain: false, status: 'granted' });
}

/** Permisiune încă necerută (cazul „putem întreba"). */
function undetermined() {
  perms.mockResolvedValue({ granted: false, canAskAgain: true, status: 'undetermined' });
}

describe('pushService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetPushCacheForTests();
    mockIsDevice = true;
    mockProjectId = 'proiect-eas-de-test';
    getToken.mockResolvedValue({ data: REAL_TOKEN, type: 'expo' });
    (api.post as jest.Mock).mockResolvedValue({ status: 204 });
    (api.delete as jest.Mock).mockResolvedValue({ status: 204 });
    undetermined();
  });

  describe('syncPushRegistration — sincronizare tăcută, fără dialog', () => {
    it('cu permisiunea acordată, înregistrează tokenul REAL primit de la Expo', async () => {
      granted();

      const outcome = await syncPushRegistration();

      expect(outcome).toEqual({ status: 'registered', token: REAL_TOKEN });
      expect(getToken).toHaveBeenCalledWith({ projectId: 'proiect-eas-de-test' });
      expect(api.post).toHaveBeenCalledWith('/push/register', {
        token: REAL_TOKEN,
        platform: Platform.OS,
      });
    });

    it('NU cere permisiunea (dialogul nu apare la pornirea aplicației)', async () => {
      undetermined();

      const outcome = await syncPushRegistration();

      expect(requestPerms).not.toHaveBeenCalled();
      expect(api.post).not.toHaveBeenCalled();
      expect(outcome).toMatchObject({ status: 'blocked', reason: 'permission-denied' });
    });

    it('pe simulator degradează curat: fără permisiuni, fără rețea, fără token', async () => {
      mockIsDevice = false;

      const outcome = await syncPushRegistration();

      expect(outcome).toMatchObject({ status: 'blocked', reason: 'simulator' });
      expect(perms).not.toHaveBeenCalled();
      expect(getToken).not.toHaveBeenCalled();
      expect(api.post).not.toHaveBeenCalled();
    });
  });

  describe('requestPushPermissionAndRegister — dialogul explicit', () => {
    it('permisiune acordată → token real trimis la /push/register', async () => {
      undetermined();
      requestPerms.mockResolvedValue({ granted: true, canAskAgain: false, status: 'granted' });

      const outcome = await requestPushPermissionAndRegister();

      expect(requestPerms).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ status: 'registered', token: REAL_TOKEN });
      expect(api.post).toHaveBeenCalledWith('/push/register', {
        token: REAL_TOKEN,
        platform: Platform.OS,
      });
    });

    it('permisiune REFUZATĂ → nu se înregistrează absolut nimic', async () => {
      undetermined();
      requestPerms.mockResolvedValue({ granted: false, canAskAgain: false, status: 'denied' });

      const outcome = await requestPushPermissionAndRegister();

      expect(outcome).toMatchObject({ status: 'blocked', reason: 'permission-denied' });
      expect(getToken).not.toHaveBeenCalled();
      expect(api.post).not.toHaveBeenCalled();
    });

    it('refuz definitiv (canAskAgain: false) → nu irosim dialogul sistemului', async () => {
      perms.mockResolvedValue({ granted: false, canAskAgain: false, status: 'denied' });

      const outcome = await requestPushPermissionAndRegister();

      expect(requestPerms).not.toHaveBeenCalled();
      expect(outcome).toMatchObject({ status: 'blocked', reason: 'permission-denied' });
      expect(api.post).not.toHaveBeenCalled();
    });

    it('fără projectId EAS → eroare CLARĂ, niciodată un token fals', async () => {
      mockProjectId = null;
      granted();

      const outcome = await requestPushPermissionAndRegister();

      expect(outcome).toMatchObject({ status: 'blocked', reason: 'missing-project-id' });
      if (outcome.status === 'blocked') {
        expect(outcome.message).toMatch(/projectId/i);
      }
      expect(getToken).not.toHaveBeenCalled();
      // Nimic nu ajunge la backend: fără token real nu există înregistrare.
      expect(api.post).not.toHaveBeenCalled();
    });

    it('Expo nu poate emite tokenul (offline / credențiale lipsă) → motiv explicit, fără excepție', async () => {
      granted();
      getToken.mockRejectedValue(new Error('Network request failed'));

      const outcome = await syncPushRegistration();

      expect(outcome).toMatchObject({ status: 'blocked', reason: 'token-unavailable' });
      expect(api.post).not.toHaveBeenCalled();
    });

    it('backend-ul respinge tokenul → motiv distinct (nu îl confundăm cu un refuz de permisiune)', async () => {
      granted();
      (api.post as jest.Mock).mockRejectedValue(new Error('500'));

      const outcome = await syncPushRegistration();

      expect(outcome).toMatchObject({ status: 'blocked', reason: 'register-failed' });
    });
  });

  describe('canalul Android', () => {
    it('pe Android creează canalul `default` (fără el, notificarea nu se afișează deloc)', async () => {
      const platform = jest.replaceProperty(Platform, 'OS', 'android');

      await ensureAndroidChannel();

      expect(setChannel).toHaveBeenCalledTimes(1);
      const [channelId, channelConfig] = setChannel.mock.calls[0];
      expect(channelId).toBe('default');
      expect(channelConfig).toMatchObject({
        importance: Notifications.AndroidImportance.MAX,
      });

      platform.restore();
    });

    it('pe iOS nu creează canale (nu există conceptul)', async () => {
      await ensureAndroidChannel();

      expect(setChannel).not.toHaveBeenCalled();
    });
  });

  describe('dezînregistrare la logout', () => {
    it('trimite DELETE /push/register cu tokenul dispozitivului', async () => {
      granted();
      await syncPushRegistration();

      await unregisterDevice();

      expect(api.delete).toHaveBeenCalledWith('/push/register', {
        data: { token: REAL_TOKEN, platform: Platform.OS },
      });
      // Notificările userului anterior nu rămân pe ecranul următorului.
      expect(Notifications.dismissAllNotificationsAsync).toHaveBeenCalled();
      expect(Notifications.setBadgeCountAsync).toHaveBeenCalledWith(0);
    });

    it('fără o înregistrare anterioară nu face nicio cerere', async () => {
      await unregisterDevice();

      expect(api.delete).not.toHaveBeenCalled();
    });

    it('nu blochează logout-ul dacă serverul nu răspunde', async () => {
      granted();
      await syncPushRegistration();
      (api.delete as jest.Mock).mockRejectedValue(new Error('network'));

      await expect(unregisterDevice()).resolves.toBeUndefined();
    });

    it('logout-ul din authStore dezînregistrează dispozitivul ÎNAINTE de a șterge sesiunea', async () => {
      granted();
      await syncPushRegistration();

      await useAuthStore.getState().logout();

      expect(api.delete).toHaveBeenCalledWith('/push/register', {
        data: { token: REAL_TOKEN, platform: Platform.OS },
      });
      expect(useAuthStore.getState().status).toBe('unauthenticated');
    });

    it('după logout, tokenul nu mai e reținut pentru contul anterior', async () => {
      granted();
      await syncPushRegistration();
      await unregisterDevice();

      // A doua dezînregistrare nu are ce trimite: cache-ul e gol.
      (api.delete as jest.Mock).mockClear();
      await unregisterDevice();

      expect(api.delete).not.toHaveBeenCalled();
    });
  });
});
