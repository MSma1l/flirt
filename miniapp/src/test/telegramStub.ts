/**
 * Un `window.Telegram.WebApp` fals, cu toate metodele spionabile.
 * Folosit de testele punții și ale autentificării.
 */
import { vi } from 'vitest';

import type { TelegramWebApp } from '@/telegram/types';

export interface TelegramStub {
  webApp: TelegramWebApp;
  /** Declanșează manual un eveniment la care aplicația s-a abonat. */
  emit: (event: string) => void;
}

export function installTelegramStub(overrides: Partial<TelegramWebApp> = {}): TelegramStub {
  const listeners = new Map<string, Set<() => void>>();

  const webApp = {
    initData: 'query_id=AAA&user=%7B%22id%22%3A1%7D&auth_date=1700000000&hash=abc',
    initDataUnsafe: { user: { id: 1, first_name: 'Ana', language_code: 'ro' } },
    version: '8.0',
    platform: 'ios',
    colorScheme: 'dark',
    themeParams: {},
    isExpanded: false,
    viewportHeight: 700,
    viewportStableHeight: 700,
    safeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
    contentSafeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
    BackButton: {
      isVisible: false,
      show: vi.fn(),
      hide: vi.fn(),
      onClick: vi.fn(),
      offClick: vi.fn(),
    },
    MainButton: {
      text: '',
      isVisible: false,
      isActive: true,
      isProgressVisible: false,
      show: vi.fn(),
      hide: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
      showProgress: vi.fn(),
      hideProgress: vi.fn(),
      setText: vi.fn(),
      setParams: vi.fn(),
      onClick: vi.fn(),
      offClick: vi.fn(),
    },
    HapticFeedback: {
      impactOccurred: vi.fn(),
      notificationOccurred: vi.fn(),
      selectionChanged: vi.fn(),
    },
    ready: vi.fn(),
    expand: vi.fn(),
    close: vi.fn(),
    isVersionAtLeast: vi.fn((v: string) => {
      const parse = (s: string) => s.split('.').map((n) => Number.parseInt(n, 10) || 0);
      const [a = 0, b = 0] = parse(String((overrides.version as string) ?? '8.0'));
      const [c = 0, d = 0] = parse(v);
      return a !== c ? a > c : b >= d;
    }),
    disableVerticalSwipes: vi.fn(),
    onEvent: vi.fn((event: string, cb: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(cb);
    }),
    offEvent: vi.fn((event: string, cb: () => void) => {
      listeners.get(event)?.delete(cb);
    }),
    ...overrides,
  } as unknown as TelegramWebApp;

  window.Telegram = { WebApp: webApp };

  return {
    webApp,
    emit: (event: string) => {
      for (const cb of listeners.get(event) ?? []) cb();
    },
  };
}
