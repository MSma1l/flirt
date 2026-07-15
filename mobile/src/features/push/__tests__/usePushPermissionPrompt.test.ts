/**
 * Momentul soft-prompt-ului de notificări. Ce apărăm aici:
 * - pe NATIV, dacă are sens, punem întrebarea NOASTRĂ (dialog reversibil) și doar
 *   pe „da" atingem dialogul sistemului; un „Nu acum" se ține minte;
 * - pe WEB push-ul e strict nativ: hook-ul iese ÎNAINTE de a atinge SecureStore /
 *   Notifications (care ar arunca în browser), deci tabul Mesaje nu crapă.
 */
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { renderHook, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';

// expo-device: comutabil per test (getter citit la momentul apelului).
let mockIsDevice = true;
jest.mock('expo-device', () => ({
  get isDevice() {
    return mockIsDevice;
  },
}));

// Dialogul nostru cross-platform și cererea reală de push sunt izolate.
jest.mock('@/utils/dialog', () => ({ confirmAsync: jest.fn() }));
jest.mock('../pushService', () => ({ requestPushPermissionAndRegister: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { confirmAsync } = require('@/utils/dialog');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { requestPushPermissionAndRegister } = require('../pushService');

import { usePushPermissionPrompt } from '../usePushPermissionPrompt';

const DECLINED_KEY = 'flirt.push.soft_prompt_declined';
const originalOS = Platform.OS;

const perms = Notifications.getPermissionsAsync as jest.Mock;
const getSecure = SecureStore.getItemAsync as jest.Mock;
const setSecure = SecureStore.setItemAsync as jest.Mock;

function setPlatform(os: 'web' | 'ios') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsDevice = true;
  // Cazul „putem întreba": permisiune încă necerută, fără refuz soft salvat.
  perms.mockResolvedValue({ granted: false, canAskAgain: true, status: 'undetermined' });
  getSecure.mockResolvedValue(null);
});

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
});

describe('usePushPermissionPrompt — WEB', () => {
  beforeEach(() => setPlatform('web'));

  it('nu atinge SecureStore/Notifications și nu deschide niciun dialog', async () => {
    renderHook(() => usePushPermissionPrompt(true));

    // Lăsăm microtask-urile effect-ului să ruleze; nimic nu trebuie să se întâmple.
    await waitFor(() => {
      expect(confirmAsync).not.toHaveBeenCalled();
    });
    expect(perms).not.toHaveBeenCalled();
    expect(getSecure).not.toHaveBeenCalled();
    expect(requestPushPermissionAndRegister).not.toHaveBeenCalled();
  });
});

describe('usePushPermissionPrompt — NATIV', () => {
  beforeEach(() => setPlatform('ios'));

  it('enabled=false: nu întreabă nimic', async () => {
    renderHook(() => usePushPermissionPrompt(false));
    await waitFor(() => expect(getSecure).not.toHaveBeenCalled());
    expect(confirmAsync).not.toHaveBeenCalled();
  });

  it('pe „Da, anunță-mă" declanșează cererea reală de permisiune', async () => {
    (confirmAsync as jest.Mock).mockResolvedValue(true);

    renderHook(() => usePushPermissionPrompt(true));

    await waitFor(() => expect(confirmAsync).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(requestPushPermissionAndRegister).toHaveBeenCalledTimes(1),
    );
    // „Da" NU salvează refuzul soft.
    expect(setSecure).not.toHaveBeenCalledWith(DECLINED_KEY, expect.anything());
  });

  it('pe „Nu acum" ține minte refuzul, fără a cere permisiunea sistemului', async () => {
    (confirmAsync as jest.Mock).mockResolvedValue(false);

    renderHook(() => usePushPermissionPrompt(true));

    await waitFor(() => expect(confirmAsync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(setSecure).toHaveBeenCalledWith(DECLINED_KEY, '1'));
    expect(requestPushPermissionAndRegister).not.toHaveBeenCalled();
  });

  it('dacă userul a refuzat deja soft (cheie salvată), nu mai întreabă', async () => {
    getSecure.mockResolvedValue('1');

    renderHook(() => usePushPermissionPrompt(true));

    await waitFor(() => expect(getSecure).toHaveBeenCalledWith(DECLINED_KEY));
    expect(confirmAsync).not.toHaveBeenCalled();
  });

  it('pe simulator (isDevice=false) nu deranjează pe nimeni', async () => {
    mockIsDevice = false;

    renderHook(() => usePushPermissionPrompt(true));

    await waitFor(() => expect(mockIsDevice).toBe(false));
    expect(perms).not.toHaveBeenCalled();
    expect(confirmAsync).not.toHaveBeenCalled();
  });
});
