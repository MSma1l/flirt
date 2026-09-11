/**
 * Dialoguri cross-platform (info + confirmare).
 *
 * `Alert.alert` din react-native e un NO-OP pe web (react-native-web nu-l
 * implementează): pe web, orice confirmare sau mesaj de eroare pur și simplu nu
 * apărea — butoanele „păreau moarte", iar erorile treceau tăcut. Aici unificăm:
 * pe web folosim `window.confirm` / `window.alert`, pe nativ `Alert.alert`.
 *
 * Folosește-le peste tot în locul lui `Alert.alert`, ca aplicația să se comporte
 * la fel în browser și pe telefon.
 */
import { Alert, Platform } from 'react-native';

import i18n from '@/i18n';

interface ConfirmOptions {
  /** Textul butonului de confirmare (implicit „OK"). */
  confirmText?: string;
  /**
   * Textul butonului de anulare. Implicit `common:actions.cancel` — aceeași
   * „Anulează" pe care o folosesc butoanele din ecrane, în limba activă.
   */
  cancelText?: string;
  /** Marchează acțiunea ca distructivă (roșu pe iOS). */
  destructive?: boolean;
}

/** Compune titlu + mesaj într-un singur text pentru dialogurile native ale browserului. */
function joinWeb(title: string, message?: string): string {
  return message ? `${title}\n\n${message}` : title;
}

/** Mesaj informativ (un singur buton), cross-platform. */
export function alertMessage(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    window.alert(joinWeb(title, message));
    return;
  }
  Alert.alert(title, message);
}

/**
 * Confirmare da/nu, cross-platform. Rezolvă `true` dacă userul confirmă,
 * `false` dacă anulează. Înlocuiește pattern-ul `Alert.alert(t, m, [cancel, ok])`.
 */
export function confirmAsync(
  title: string,
  message?: string,
  opts: ConfirmOptions = {},
): Promise<boolean> {
  // Traducerea se citește la FIECARE apel, nu la încărcarea modulului: dacă
  // userul comută limba, următorul dialog o urmează. Modulul nu e o componentă,
  // deci nu poate folosi `useTranslation` — citim din instanța globală, aceeași
  // pe care o inițializează `app/_layout.tsx` (și `jest.setup.js` în teste).
  const {
    confirmText = 'OK',
    cancelText = i18n.t('common:actions.cancel'),
    destructive = false,
  } = opts;
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    return Promise.resolve(window.confirm(joinWeb(title, message)));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelText, style: 'cancel', onPress: () => resolve(false) },
      {
        text: confirmText,
        style: destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ]);
  });
}
