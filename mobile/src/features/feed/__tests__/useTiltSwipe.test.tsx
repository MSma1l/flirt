import { renderHook, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { TILT_RELEASE, TILT_TRIGGER, useTiltSwipe } from '../useTiltSwipe';

// Jest n-are senzori reali: ținem callback-ul înregistrat și îl chemăm noi.
type MotionListener = (data: { rotation?: { beta: number; gamma: number } }) => void;
let listener: MotionListener | null = null;
const mockRemove = jest.fn();
const mockAddListener = jest.fn((cb: MotionListener) => {
  listener = cb;
  return { remove: mockRemove };
});
const mockIsAvailableAsync = jest.fn(async () => true);
const mockSetUpdateInterval = jest.fn();

jest.mock('expo-sensors', () => ({
  DeviceMotion: {
    isAvailableAsync: () => mockIsAvailableAsync(),
    setUpdateInterval: (ms: number) => mockSetUpdateInterval(ms),
    addListener: (cb: MotionListener) => mockAddListener(cb),
  },
}));

/** Trimite o citire de senzor (unghiuri absolute, radiani). */
function emit(beta: number, gamma: number) {
  listener?.({ rotation: { beta, gamma } });
}

/** Prima citire fixează poziția de repaus; de la ea se măsoară înclinarea. */
const REST = 0;

function setPlatform(os: string) {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
}

describe('useTiltSwipe', () => {
  beforeEach(() => {
    listener = null;
    mockRemove.mockClear();
    mockAddListener.mockClear();
    mockIsAvailableAsync.mockClear();
    mockIsAvailableAsync.mockResolvedValue(true);
    mockSetUpdateInterval.mockClear();
  });

  async function mountTilt(onDirection: jest.Mock, enabled = true) {
    const view = renderHook(() => useTiltSwipe({ enabled, onDirection }));
    await waitFor(() => expect(mockAddListener).toHaveBeenCalled());
    emit(REST, REST); // baseline
    return view;
  }

  it('pe web nu pornește senzorul deloc', async () => {
    setPlatform('web');
    const onDirection = jest.fn();
    renderHook(() => useTiltSwipe({ enabled: true, onDirection }));

    // Lăsăm microtask-urile să curgă: nici măcar nu întrebăm de disponibilitate.
    await waitFor(() => expect(mockIsAvailableAsync).not.toHaveBeenCalled());
    expect(mockAddListener).not.toHaveBeenCalled();
  });

  it('pe nativ pornește senzorul și se dezabonează la unmount', async () => {
    const onDirection = jest.fn();
    const { unmount } = await mountTilt(onDirection);

    expect(mockSetUpdateInterval).toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();

    unmount();
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });

  it('dacă senzorul nu e disponibil, degradează tăcut (fără abonament, fără eroare)', async () => {
    mockIsAvailableAsync.mockResolvedValue(false);
    const onDirection = jest.fn();
    renderHook(() => useTiltSwipe({ enabled: true, onDirection }));

    await waitFor(() => expect(mockIsAvailableAsync).toHaveBeenCalled());
    expect(mockAddListener).not.toHaveBeenCalled();
    expect(onDirection).not.toHaveBeenCalled();
  });

  it('înclinarea peste prag declanșează cele 4 direcții', async () => {
    const cases: Array<[string, number, number]> = [
      // [direcție așteptată, beta, gamma] — relative la repaus (0, 0).
      ['right', REST, TILT_TRIGGER + 0.1],
      ['left', REST, -(TILT_TRIGGER + 0.1)],
      ['up', -(TILT_TRIGGER + 0.1), REST],
      ['down', TILT_TRIGGER + 0.1, REST],
    ];

    for (const [expected, beta, gamma] of cases) {
      const onDirection = jest.fn();
      const { unmount } = await mountTilt(onDirection);

      emit(beta, gamma);
      expect(onDirection).toHaveBeenCalledWith(expected);

      unmount();
    }
  });

  it('sub prag nu declanșează nimic', async () => {
    const onDirection = jest.fn();
    await mountTilt(onDirection);

    emit(REST, TILT_TRIGGER - 0.05);
    emit(-(TILT_TRIGGER - 0.05), REST);
    expect(onDirection).not.toHaveBeenCalled();
  });

  it('înclinare pe diagonală: nu ghicește o direcție', async () => {
    const onDirection = jest.fn();
    await mountTilt(onDirection);

    // Ambele axe peste prag, egale → nicio axă nu domină.
    emit(TILT_TRIGGER + 0.2, TILT_TRIGGER + 0.2);
    expect(onDirection).not.toHaveBeenCalled();
  });

  it('histerezis: telefonul ținut înclinat declanșează O SINGURĂ dată', async () => {
    const onDirection = jest.fn();
    await mountTilt(onDirection);

    emit(REST, TILT_TRIGGER + 0.2);
    expect(onDirection).toHaveBeenCalledTimes(1);

    // Telefonul rămâne înclinat: fără rearmare, nu mai tragem acțiuni.
    emit(REST, TILT_TRIGGER + 0.3);
    emit(REST, TILT_TRIGGER + 0.25);
    expect(onDirection).toHaveBeenCalledTimes(1);

    // Revine la neutru → se rearmează → o nouă înclinare declanșează iar.
    emit(REST, TILT_RELEASE - 0.05);
    emit(REST, TILT_TRIGGER + 0.2);
    expect(onDirection).toHaveBeenCalledTimes(2);
  });

  it('revenirea parțială (încă peste zona neutră) NU rearmează', async () => {
    const onDirection = jest.fn();
    await mountTilt(onDirection);

    emit(REST, TILT_TRIGGER + 0.2);
    expect(onDirection).toHaveBeenCalledTimes(1);

    // Coboară sub prag, dar rămâne peste zona de release.
    emit(REST, TILT_RELEASE + 0.05);
    emit(REST, TILT_TRIGGER + 0.2);
    expect(onDirection).toHaveBeenCalledTimes(1);
  });

  it('când `enabled` e false (ex. o acțiune în curs), nu declanșează', async () => {
    const onDirection = jest.fn();
    await mountTilt(onDirection, false);

    emit(REST, TILT_TRIGGER + 0.2);
    expect(onDirection).not.toHaveBeenCalled();
  });

  it('poziția de repaus e a userului: înclinarea se măsoară față de ea', async () => {
    const onDirection = jest.fn();
    renderHook(() => useTiltSwipe({ enabled: true, onDirection }));
    await waitFor(() => expect(mockAddListener).toHaveBeenCalled());

    // Userul ține telefonul deja înclinat la 0.8 rad — asta e „neutru" pentru el.
    emit(0.8, 0.8);
    emit(0.8, 0.8);
    expect(onDirection).not.toHaveBeenCalled();

    // Doar o abatere reală de la poziția LUI contează.
    emit(0.8, 0.8 + TILT_TRIGGER + 0.1);
    expect(onDirection).toHaveBeenCalledWith('right');
  });
});
