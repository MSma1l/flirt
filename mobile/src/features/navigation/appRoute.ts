/**
 * UNDE trebuie să fie userul, acum. Singurul loc din aplicație care răspunde.
 *
 * DE CE există: navigarea de start era împărțită între `app/index.tsx` (redirect
 * la cold-start, care știa doar de `profile_completed`) și `AuthGuard`
 * (reactiv, care știa și de testul de umor). Două locuri care decideau același
 * lucru cu cunoștințe diferite: la înregistrare se călcau reciproc — ecranul
 * trimitea la `/humor`, poarta trimitea în feed — și userul ajungea în feed fără
 * testul de umor, unde `POST /feed/swipe` îi răspundea 403 la fiecare swipe.
 *
 * Acum ecranele NU mai decid: login, register și quiz-ul trimit userul la `/`,
 * iar de acolo `AuthGuard` (singurul care navighează) îl duce unde spune
 * `resolveAppRoute`.
 */
import { useAuthStore, type AuthStatus } from '@/store/authStore';
import { useHumorGate } from '@/features/humor/humorGate';

import { useServerGateStore } from './serverGate';

/** Rutele către care poate trimite poarta. */
export type AppRoute =
  | '/(auth)/welcome'
  | '/(onboarding)'
  | '/profile/edit'
  | '/humor'
  | '/(tabs)/ankete';

/** Primul segment al fiecărei rute — cu el aflăm dacă userul e DEJA acolo. */
const ROUTE_SEGMENT: Record<AppRoute, string> = {
  '/(auth)/welcome': '(auth)',
  '/(onboarding)': '(onboarding)',
  '/profile/edit': 'profile',
  '/humor': 'humor',
  '/(tabs)/ankete': '(tabs)',
};

/**
 * Ecranele în care userul intră DOAR pentru că i le cere poarta, deci de unde
 * are voie să fie scos automat când poarta se deschide. De pe orice alt ecran
 * (chat, eveniment, setări) NU: cine citește un mesaj nu vrea să fie smuls în
 * feed pentru că s-a împrospătat o interogare.
 *
 * `humor` NU e în listă, deși poarta chiar trimite acolo: la el se ajunge și de
 * bunăvoie, din Setări → „Testul de umor". Ecranul de quiz știe singur să iasă
 * (butonul de final duce la `/`), deci n-avem de ce să-l scoatem noi — l-am
 * arunca afară exact pe cel care voia să-și redea testul.
 */
const GATE_SEGMENTS: readonly string[] = ['(auth)', '(onboarding)'];

export interface AppRouteInput {
  status: AuthStatus;
  /**
   * Flagul de pe server (`GET /auth/me`), nu o presupunere a clientului.
   *
   * Atenție: pe server e ȘI-ul dintre „anketă completă" și „destule poze"
   * (`profile_service._sync_profile_completed`), deci `false` singur NU spune
   * care dintre ele lipsește — vezi `needsPhotos`.
   */
  profileCompleted: boolean;
  /** Serverul a confirmat că vectorul de umor lipsește (vezi `humorGate`). */
  needsQuiz: boolean;
  /** Poarta de umor încă n-are verdict: NU decidem pripit, așteptăm. */
  humorPending: boolean;
  /**
   * Serverul a precizat că lipsesc POZELE, nu anketa (403 distinct la swipe).
   * Lămurește `profileCompleted: false`; în rest nu schimbă nimic.
   */
  needsPhotos: boolean;
}

/**
 * Ruta obligatorie pentru starea dată; `null` = „nicio pretenție, lasă userul
 * unde e" (starea încă nu e cunoscută).
 *
 * Ordinea repetă ordinea porților de pe server (`feed_service._authorize_swipe`):
 * profil (anketă sau poze) → umor. Așa, ecranul la care trimitem e mereu prima
 * problemă pe care serverul o va reclama, nu a doua.
 */
export function resolveAppRoute(input: AppRouteInput): AppRoute | null {
  // Splash: hidratarea sesiunii e în curs, nu știm nici măcar cine e userul.
  if (input.status === 'loading') return null;
  if (input.status === 'unauthenticated') return '/(auth)/welcome';

  if (!input.profileCompleted) {
    // Pozele se adaugă în editorul de profil, NU în wizardul de anketă: wizardul
    // ar reporni de la pasul 0 cu un draft gol și i-ar rescrie profilul la final.
    // Fără precizarea serverului rămâne wizardul — anketa lipsă e cazul normal.
    return input.needsPhotos ? '/profile/edit' : '/(onboarding)';
  }

  // „Încă nu știu" NU e „n-are nevoie": fără așteptarea asta, userul intră o
  // clipă în feed și e scos imediat la quiz.
  if (input.humorPending) return null;
  if (input.needsQuiz) return '/humor';

  return '/(tabs)/ankete';
}

/**
 * Ruta cerută, filtrată prin „userul e deja acolo?" — ce rămâne e exact ce
 * trebuie dat lui `router.dismissTo`, sau `null` dacă nu e nimic de făcut.
 */
export function navigationTarget(
  route: AppRoute | null,
  segments: readonly string[],
): AppRoute | null {
  if (route === null) return null;

  // Ruta index (splash) nu are segmente: acolo userul nu poate rămâne niciodată.
  const onIndex = segments.length === 0;

  if (route === '/(tabs)/ankete') {
    // „Fără pretenții": îl aducem în aplicație doar dacă stă pe splash sau într-un
    // ecran-poartă care tocmai s-a deschis.
    return onIndex || GATE_SEGMENTS.includes(segments[0]) ? route : null;
  }

  return !onIndex && segments[0] === ROUTE_SEGMENT[route] ? null : route;
}

/** Ruta obligatorie pentru userul curent. Citește toate porțile într-un loc. */
export function useAppRoute(): AppRoute | null {
  const status = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.user?.id);
  const profileCompleted = useAuthStore((s) => s.user?.profile_completed);
  const { needsQuiz, pending } = useHumorGate();
  const needsPhotosForUserId = useServerGateStore((s) => s.needsPhotosForUserId);

  return resolveAppRoute({
    status,
    profileCompleted: !!profileCompleted,
    needsQuiz,
    humorPending: pending,
    needsPhotos: !!userId && needsPhotosForUserId === userId,
  });
}
