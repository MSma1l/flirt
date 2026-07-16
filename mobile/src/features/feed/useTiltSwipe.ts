/**
 * Comandă deck-ul de ankete prin înclinarea telefonului (TZ 4.4).
 *
 * Sursa e `DeviceMotion` (fuziune giroscop + accelerometru), nu `Gyroscope` brut:
 * giroscopul dă VITEZĂ unghiulară (rad/s), din care ar trebui să integrăm noi
 * unghiul — cu drift cu tot. `DeviceMotion.rotation` dă direct orientarea
 * absolută, adică exact ce înseamnă „am înclinat telefonul".
 *
 * DOAR pe nativ. Pe web nu pornim senzorul deloc (fără eroare, fără warning):
 * acolo deck-ul rămâne pe swipe cu mouse-ul/degetul.
 */
import { DeviceMotion } from 'expo-sensors';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { AXIS_DOMINANCE, SwipeDirection } from './swipeDirection';

/**
 * Unghiul (radiani) de la care înclinarea declanșează o acțiune.
 * 0.55 rad ≈ 31° — o mișcare deliberată, nu tremurul mâinii sau mersul pe stradă.
 * Într-un app de dating un like accidental nu se poate lua înapoi social, deci
 * pragul e intenționat GENEROS. Mai bine repetă userul gestul decât să dea like
 * cuiva pe care nu l-a vrut.
 */
export const TILT_TRIGGER = 0.55;

/**
 * Histerezis: după o acțiune, senzorul e „dezarmat" până când telefonul revine
 * sub 0.25 rad (≈ 14°) pe AMBELE axe. Fără asta, cât timp telefonul stă înclinat
 * peste prag am trage câte o acțiune la fiecare citire (10/secundă) — adică am
 * mătura tot deck-ul dintr-o singură mișcare.
 */
export const TILT_RELEASE = 0.25;

/** 100 ms = 10 citiri/secundă. Destul pentru un gest de ~0.5 s, puțin pentru baterie. */
export const TILT_INTERVAL_MS = 100;

interface UseTiltSwipeOptions {
  /** Când e false, senzorul rămâne pornit dar nu declanșează nimic (ex. cât timp `busy`). */
  enabled: boolean;
  /** Chemat o singură dată per înclinare, cu direcția rezolvată. */
  onDirection: (direction: SwipeDirection) => void;
}

export function useTiltSwipe({ enabled, onDirection }: UseTiltSwipeOptions): void {
  // Ref-uri: vrem UN singur abonament pe toată viața ecranului. Dacă am pune
  // `enabled`/`onDirection` în deps, ne-am reabona la fiecare swipe și am pierde
  // baseline-ul (adică poziția „de repaus" a mâinii) exact când e mai nevoie.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const onDirectionRef = useRef(onDirection);
  onDirectionRef.current = onDirection;

  useEffect(() => {
    // Web: nici măcar nu atingem senzorul.
    if (Platform.OS === 'web') return;

    let subscription: { remove: () => void } | null = null;
    let cancelled = false;

    /** Poziția de repaus, luată la prima citire: fiecare om ține telefonul altfel. */
    let baseline: { beta: number; gamma: number } | null = null;
    /** Histerezis: false = telefonul e încă înclinat, așteptăm să revină la neutru. */
    let armed = true;

    const start = async () => {
      // Senzor indisponibil (emulator, telefon fără giroscop) → degradare tăcută la swipe.
      const available = await DeviceMotion.isAvailableAsync().catch(() => false);
      if (!available || cancelled) return;

      DeviceMotion.setUpdateInterval(TILT_INTERVAL_MS);
      subscription = DeviceMotion.addListener((data) => {
        const rotation = data?.rotation;
        if (!rotation) return;

        const { beta, gamma } = rotation;
        if (typeof beta !== 'number' || typeof gamma !== 'number') return;

        if (baseline === null) {
          baseline = { beta, gamma };
          return;
        }

        // gamma = ruliu (înclinare stânga/dreapta), beta = tangaj (față/spate).
        const dGamma = gamma - baseline.gamma;
        const dBeta = beta - baseline.beta;

        const aGamma = Math.abs(dGamma);
        const aBeta = Math.abs(dBeta);

        // Rearmare: telefonul a revenit aproape de poziția de repaus.
        if (!armed) {
          if (aGamma < TILT_RELEASE && aBeta < TILT_RELEASE) armed = true;
          return;
        }

        if (!enabledRef.current) return;

        let direction: SwipeDirection | null = null;

        // Aceeași regulă de dominanță ca la deget: o înclinare „pe diagonală"
        // nu ghicește o direcție, o ignoră.
        if (aGamma >= TILT_TRIGGER && aGamma >= aBeta * AXIS_DOMINANCE) {
          direction = dGamma > 0 ? 'right' : 'left';
        } else if (aBeta >= TILT_TRIGGER && aBeta >= aGamma * AXIS_DOMINANCE) {
          // beta scade când vârful telefonului se duce în FAȚĂ (departe de user) → „sus".
          direction = dBeta < 0 ? 'up' : 'down';
        }

        if (direction) {
          armed = false;
          onDirectionRef.current(direction);
        }
      });
    };

    start();

    // Un senzor lăsat pornit mănâncă baterie: îl oprim la ieșirea din ecran.
    return () => {
      cancelled = true;
      subscription?.remove();
      subscription = null;
    };
  }, []);
}
