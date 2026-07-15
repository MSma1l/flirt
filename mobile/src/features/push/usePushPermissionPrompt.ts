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
import { Alert } from 'react-native';

import { requestPushPermissionAndRegister } from './pushService';

/** „Nu acum" se ține minte între sesiuni — altfel întrebarea devine spam. */
const SOFT_PROMPT_DECLINED_KEY = 'flirt.push.soft_prompt_declined';

async function shouldSoftPrompt(): Promise<boolean> {
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

function askSoftly(): void {
  Alert.alert(
    'Te anunțăm când primești un mesaj?',
    'Trimitem notificări doar pentru mesaje noi și potriviri. Poți opri oricând din setările telefonului.',
    [
      {
        text: 'Nu acum',
        style: 'cancel',
        onPress: () => {
          void SecureStore.setItemAsync(SOFT_PROMPT_DECLINED_KEY, '1');
        },
      },
      {
        text: 'Da, anunță-mă',
        onPress: () => {
          // Abia acum atingem dialogul sistemului — cu un „da" deja în buzunar.
          void requestPushPermissionAndRegister();
        },
      },
    ],
  );
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
      if (should) askSoftly();
    });
  }, [enabled]);
}
