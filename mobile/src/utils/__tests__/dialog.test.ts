/** Teste pentru dialogurile cross-platform (web vs nativ). */
import { Alert, Platform } from 'react-native';

import { alertMessage, confirmAsync } from '../dialog';

describe('dialog cross-platform', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
    jest.restoreAllMocks();
    delete (global as { confirm?: unknown }).confirm;
    delete (global as { alert?: unknown }).alert;
  });

  function setPlatform(os: 'web' | 'ios') {
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  }

  describe('web', () => {
    it('confirmAsync → window.confirm; true la OK, false la Cancel', async () => {
      setPlatform('web');
      const confirmMock = jest.fn().mockReturnValue(true);
      (global as { confirm?: unknown }).confirm = confirmMock;

      await expect(confirmAsync('Ștergi?', 'Nu se poate anula.')).resolves.toBe(true);
      expect(confirmMock).toHaveBeenCalledWith('Ștergi?\n\nNu se poate anula.');

      confirmMock.mockReturnValue(false);
      await expect(confirmAsync('Ștergi?')).resolves.toBe(false);
    });

    it('alertMessage → window.alert', () => {
      setPlatform('web');
      const alertMock = jest.fn();
      (global as { alert?: unknown }).alert = alertMock;
      alertMessage('Eroare', 'Ceva n-a mers.');
      expect(alertMock).toHaveBeenCalledWith('Eroare\n\nCeva n-a mers.');
    });
  });

  describe('nativ', () => {
    it('confirmAsync → Alert.alert cu butoane; „OK" rezolvă true', async () => {
      setPlatform('ios');
      const spy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
        const ok = buttons?.find((b) => b.style !== 'cancel');
        ok?.onPress?.();
      });
      await expect(confirmAsync('Ștergi?', 'x', { destructive: true })).resolves.toBe(true);
      expect(spy).toHaveBeenCalled();
    });

    it('alertMessage → Alert.alert', () => {
      setPlatform('ios');
      const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      alertMessage('Eroare', 'x');
      expect(spy).toHaveBeenCalledWith('Eroare', 'x');
    });
  });
});
