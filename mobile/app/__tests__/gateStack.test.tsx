/**
 * Ce lasă poarta ÎN STIVĂ. Singurul test cu navigator adevărat (`renderRouter`):
 * restul testelor de navigare mock-uiesc `expo-router`, deci n-au cum să vadă
 * exact bugul de mai jos.
 *
 * Bugul: `AuthGuard` naviga cu `router.replace`, care schimbă doar VÂRFUL stivei
 * rădăcină. Când peste aplicație e deschis cu `push` un ecran — quiz-ul din
 * Setări, un story, un chat — stiva e `[(tabs), <ecran>]`. Un „du-l în feed" cu
 * `replace` înlocuia doar `<ecran>`, iar feed-ul de dedesubt rămânea montat:
 * `[(tabs), (tabs)]`, adică DOUĂ ecrane de ankete în același timp — două bare de
 * story-uri, două carduri unul peste altul, două bare de taburi.
 *
 * `dismissTo` se întoarce la ecranul care există deja în spate (îl refolosește,
 * cu tot cu tabul pe care era userul); dacă nu există, se poartă ca `replace`.
 */
import { Stack, Tabs, router } from 'expo-router';
import { act, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import React from 'react';
import { Text, View } from 'react-native';

import { AuthGuard } from '../_layout';

jest.mock('@expo-google-fonts/manrope', () => ({
  useFonts: () => [true],
  Manrope_400Regular: 'Manrope_400Regular',
  Manrope_500Medium: 'Manrope_500Medium',
  Manrope_700Bold: 'Manrope_700Bold',
}));

// Store de auth fals, dar zustand REAL (poarta citește prin selectori).
jest.mock('@/store/authStore', () => {
  const { create } = jest.requireActual('zustand');
  return {
    useAuthStore: create(() => ({
      status: 'authenticated',
      user: { id: 'u1', email: 'ana@flirt.md', profile_completed: true },
      hydrate: jest.fn(),
      refreshUser: jest.fn(),
    })),
  };
});

// Poarta de umor, comandată din test: aici ne interesează CE face `AuthGuard` cu
// stiva, nu cum află că mai are nevoie de quiz (asta e în `humorGate.test.tsx`).
const { create: mockCreate } = jest.requireActual('zustand');
const mockGate = mockCreate(() => ({ needsQuiz: false, pending: false }));
jest.mock('@/features/humor/humorGate', () => ({
  useHumorGate: () => mockGate((s: unknown) => s),
}));
const setGate = (state: { needsQuiz: boolean; pending: boolean }) =>
  mockGate.setState(state);

/** Aplicația în mic: splash, taburi, quiz — exact structura din `app/`. */
const routes = {
  _layout: () => (
    <>
      <AuthGuard />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="stories/new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="humor" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  ),
  index: () => <Text testID="splash">splash</Text>,
  '(tabs)/_layout': () => <Tabs screenOptions={{ headerShown: false }} />,
  '(tabs)/ankete': () => (
    <View testID="deck">
      <Text>deck</Text>
    </View>
  ),
  '(tabs)/mesaje': () => <Text testID="mesaje">mesaje</Text>,
  humor: () => <Text testID="quiz">quiz</Text>,
  'stories/new': () => <Text testID="story-nou">story nou</Text>,
};

/** Aplicația randată, ca să putem citi starea navigatorului. */
let app: ReturnType<typeof renderRouter>;

/** Numele rutelor din stiva RĂDĂCINĂ, de jos în sus. */
function rootStack(): string[] {
  const state = app.getRouterState();
  const root = state?.routes?.[0]?.state as { routes?: { name: string }[] } | undefined;
  return (root?.routes ?? []).map((route) => route.name);
}

describe('AuthGuard: ce lasă în stiva rădăcină', () => {
  beforeEach(() => {
    setGate({ needsQuiz: false, pending: false });
  });

  it('quiz deschis PESTE feed → întoarcerea nu montează un al doilea feed', async () => {
    app = renderRouter(routes, { initialUrl: '/' });
    // Din splash, poarta duce userul în aplicație.
    await waitFor(() => expect(screen.getByTestId('deck')).toBeTruthy());
    expect(rootStack()).toEqual(['(tabs)']);

    // Setări → „Testul de umor": quiz-ul se deschide PESTE aplicație (`push`).
    await act(async () => {
      router.push('/humor');
    });
    await waitFor(() => expect(screen.getByTestId('quiz')).toBeTruthy());
    expect(rootStack()).toEqual(['(tabs)', 'humor']);

    // Quiz-ul cere ieșirea prin splash, cum face `humor.tsx` la butonul de final.
    await act(async () => {
      router.replace('/');
    });

    // Poarta îl duce înapoi în feed — și feed-ul rămâne UNUL singur.
    await waitFor(() => expect(screen.getByTestId('deck')).toBeTruthy());
    expect(rootStack()).toEqual(['(tabs)']);
  });

  it('poarta cheamă la quiz dintr-un ecran deschis peste feed, fără să-l stivuiască', async () => {
    app = renderRouter(routes, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('deck')).toBeTruthy());

    // Userul deschide „Story nou" peste feed.
    await act(async () => {
      router.push('/stories/new');
    });
    await waitFor(() => expect(screen.getByTestId('story-nou')).toBeTruthy());
    expect(rootStack()).toEqual(['(tabs)', 'stories/new']);

    // Serverul confirmă acum că vectorul de umor lipsește (un 403 la swipe, un
    // refetch al porții). Quiz-ul ia locul ecranului deschis peste feed — nu se
    // adaugă un al treilea etaj peste el.
    await act(async () => {
      setGate({ needsQuiz: true, pending: false });
    });
    await waitFor(() => expect(screen.getByTestId('quiz')).toBeTruthy());
    expect(rootStack()).toEqual(['(tabs)', 'humor']);
  });
});
