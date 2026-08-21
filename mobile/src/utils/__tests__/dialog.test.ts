/** Teste pentru dialogurile cross-platform (web vs nativ). */
import { Alert, Platform } from 'react-native';

import { alertMessage, confirmAsync } from '../dialog';
import i18n from '@/i18n';

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

  /**
   * Modulul NU e o componentă, deci nu poate folosi `useTranslation`: citește
   * din instanța globală. De aici două lucruri de verificat — că butonul de
   * anulare chiar vine din catalog și că traducerea se ia la FIECARE apel, nu o
   * dată la încărcarea modulului (altfel primul dialog ar îngheța limba).
   */
  describe('i18n', () => {
    afterEach(async () => {
      await i18n.changeLanguage('ro');
    });

    /** Textul butonului de anulare din ultimul `Alert.alert`. */
    function cancelTextOf(spy: jest.SpyInstance): string | undefined {
      const buttons = spy.mock.calls[0][2] as { text?: string; style?: string }[] | undefined;
      return buttons?.find((b) => b.style === 'cancel')?.text;
    }

    it('butonul de anulare vine din `common:actions.cancel`', async () => {
      setPlatform('ios');
      const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

      confirmAsync('Ștergi?');
      expect(cancelTextOf(spy)).toBe('Anulează');
    });

    it('urmează limba activă la fiecare apel', async () => {
      setPlatform('ios');
      await i18n.changeLanguage('ru');
      const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

      confirmAsync('Удалить?');
      expect(cancelTextOf(spy)).toBe('Отмена');
    });

    it('un `cancelText` explicit are prioritate', () => {
      setPlatform('ios');
      const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

      confirmAsync('Ștergi?', undefined, { cancelText: 'Nu acum' });
      expect(cancelTextOf(spy)).toBe('Nu acum');
    });
  });
});
