/**
 * Hook-uri React peste puntea Telegram.
 *
 * Toate pornesc de la premisa că `bridge.ts` nu aruncă niciodată: aici nu mai
 * există verificări de „suntem în Telegram?", doar abonări și curățare.
 */
import { useEffect, useSyncExternalStore } from 'react';

import { applyTheme } from '@/theme/applyTheme';

import {
  disableVerticalSwipes,
  expand,
  getColorScheme,
  getContentSafeAreaInset,
  getSafeAreaInset,
  getThemeParams,
  getViewportStableHeight,
  onEvent,
  ready,
  showBackButton,
  showMainButton,
  type MainButtonOptions,
} from './bridge';

/**
 * Pornirea Mini App-ului: anunță clientul, extinde fereastra și blochează
 * închiderea la swipe vertical (altfel deck-ul de swipe ar închide aplicația).
 * De chemat O SINGURĂ DATĂ, cât mai devreme.
 */
export function useTelegramBootstrap(): void {
  useEffect(() => {
    ready();
    expand();
    disableVerticalSwipes();
  }, []);
}

/** Subscriere la evenimentele care schimbă tema sau geometria ferestrei. */
function subscribeToChrome(onChange: () => void): () => void {
  const unsubscribers = [
    onEvent('themeChanged', onChange),
    onEvent('viewportChanged', onChange),
    onEvent('safeAreaChanged', onChange),
    onEvent('contentSafeAreaChanged', onChange),
  ];
  // Browser obișnuit: nu există evenimente Telegram, dar fereastra se
  // redimensionează la rotire sau la deschiderea tastaturii.
  const onResize = () => onChange();
  window.addEventListener('resize', onResize);
  return () => {
    for (const off of unsubscribers) off();
    window.removeEventListener('resize', onResize);
  };
}

/** Semnătura stării vizuale — se schimbă doar când chiar s-a schimbat ceva. */
function chromeSnapshot(): string {
  const safe = getSafeAreaInset();
  const content = getContentSafeAreaInset();
  return [
    getColorScheme(),
    JSON.stringify(getThemeParams()),
    Math.round(getViewportStableHeight()),
    safe.top,
    safe.bottom,
    safe.left,
    safe.right,
    content.top,
    content.bottom,
  ].join('|');
}

/**
 * Ține tema și geometria sincronizate cu clientul.
 * Întoarce schema activă, pentru componentele care au nevoie de ea în JS.
 */
export function useTelegramChrome(): 'light' | 'dark' {
  // `useSyncExternalStore` ne scutește de un `useState` + patru `useEffect`:
  // reciteşte instantaneul doar când clientul emite un eveniment.
  const snapshot = useSyncExternalStore(subscribeToChrome, chromeSnapshot, chromeSnapshot);

  useEffect(() => {
    applyTheme({
      scheme: getColorScheme(),
      params: getThemeParams(),
      safeArea: getSafeAreaInset(),
      contentSafeArea: getContentSafeAreaInset(),
      stableHeight: getViewportStableHeight(),
    });
  }, [snapshot]);

  return getColorScheme();
}

/**
 * Butonul Înapoi nativ. `onBack === null` îl ascunde.
 * În browser nu apare nimic — ecranele trebuie să aibă și o cale proprie.
 */
export function useTelegramBackButton(onBack: (() => void) | null): void {
  useEffect(() => {
    if (!onBack) return;
    return showBackButton(onBack);
  }, [onBack]);
}

/** Butonul principal nativ. `options === null` îl ascunde. */
export function useTelegramMainButton(options: MainButtonOptions | null): void {
  const { text, onClick, enabled, loading } = options ?? {};
  useEffect(() => {
    if (!text || !onClick) return;
    return showMainButton({ text, onClick, enabled, loading });
  }, [text, onClick, enabled, loading]);
}
