/**
 * MOMENTUL în care cerem permisiunea de notificări.
 *
 * Nu la pornirea aplicației. Pe iOS dialogul sistemului se poate afișa o
 * SINGURĂ dată per instalare: dacă userul îl refuză (iar la primul ecran, când
 * încă nu știe ce e aplicația, îl refuză aproape sigur), aplicația nu mai poate
 * cere nimic — doar el, din Setările telefonului. Practic am arde definitiv
 * singura șansă.
 *
 * De aceea: (1) întrebăm abia când notificarea are un sens evident pentru user
 * — are deja conversații, deci așteaptă răspunsuri; (2) punem întâi o întrebare
 * a NOASTRĂ (dialog obișnuit, reversibil), și doar pe „da" deschidem dialogul
 * sistemului. Un „Nu acum" nu costă nimic și păstrează prompt-ul real pentru
 * mai târziu.
 */
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { confirmAsync } from '@/utils/dialog';

import { requestPushPermissionAndRegister } from './pushService';

/** „Nu acum" se ține minte între sesiuni — altfel întrebarea devine spam. */
const SOFT_PROMPT_DECLINED_KEY = 'flirt.push.soft_prompt_declined';

async function shouldSoftPrompt(): Promise<boolean> {
  // Web: push-ul e strict nativ, iar SecureStore/Notifications ar arunca aici
  // (nu există în browser). Ieșim ÎNAINTE de a le atinge — nicio permisiune de
  // cerut, nimic de crăpat. Tabul Mesaje se montează curat pe web.
  if (Platform.OS === 'web') return false;

  // Simulator: nu există push, deci nu are rost să deranjăm pe nimeni.
  if (!Device.isDevice) return false;

  const perm = await Notifications.getPermissionsAsync();
  const granted =
    perm.granted || perm.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  // Deja acordată: înregistrarea o face PushBridge, tăcut.
  if (granted) return false;

  // Refuz definitiv: dialogul sistemului nu s-ar mai afișa, iar al nostru ar fi
  // o promisiune goală.
  if (!perm.canAskAgain) return false;

  const declined = await SecureStore.getItemAsync(SOFT_PROMPT_DECLINED_KEY);
  return declined === null;
}

async function askSoftly(): Promise<void> {
  // `confirmAsync` e dialogul nostru cross-platform (pe web `Alert.alert` e no-op,
  // deci butoarele ar „părea moarte"). „Da" = confirmare, „Nu acum" = anulare.
  const yes = await confirmAsync(
    'Te anunțăm când primești un mesaj?',
    'Trimitem notificări doar pentru mesaje noi și potriviri. Poți opri oricând din setările telefonului.',
    { confirmText: 'Da, anunță-mă', cancelText: 'Nu acum' },
  );

  if (yes) {
    // Abia acum atingem dialogul sistemului — cu un „da" deja în buzunar.
    void requestPushPermissionAndRegister();
    return;
  }

  // „Nu acum": ținem minte refuzul soft ca să nu revenim cu întrebarea la fiecare
  // montare. (Se ajunge aici doar pe nativ — pe web am ieșit deja din shouldSoftPrompt.)
  void SecureStore.setItemAsync(SOFT_PROMPT_DECLINED_KEY, '1');
}

/**
 * @param enabled devine `true` în momentul în care notificările au sens pentru
 * user (ex. are cel puțin o conversație). Întrebăm o singură dată per montare.
 */
export function usePushPermissionPrompt(enabled: boolean): void {
  const alreadyAsked = useRef(false);

  useEffect(() => {
    if (!enabled || alreadyAsked.current) return;
    alreadyAsked.current = true;

    void shouldSoftPrompt().then((should) => {
      if (should) void askSoftly();
    });
  }, [enabled]);
}
