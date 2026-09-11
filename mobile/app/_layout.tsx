/** Root layout — providers globale (temă, react-query), fonturi, hidratare auth. */
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_700Bold,
  useFonts,
} from '@expo-google-fonts/manrope';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useNavigationContainerRef, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { navigationTarget, useAppRoute } from '@/features/navigation/appRoute';
import { PushBridge } from '@/features/push/PushBridge';
// Importul inițializează instanța i18n (sincron, pe `ro`); `initI18n` comută
// apoi pe limba salvată de user sau pe cea a dispozitivului.
import { initI18n } from '@/i18n';
import { useAuthStore } from '@/store/authStore';
import { ThemeProvider } from '@theme/index';

// Implicit: datele rămân „proaspete" 30s, deci navigarea între ecrane nu declanșează
// un refetch la fiecare montare. Query-urile care au nevoie de date mai proaspete
// (chat/mesaje) își suprascriu local prin `refetchInterval`, care rulează oricum.
// `retry: 1` taie retry-urile multiple pe rețea moartă.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: 1,
    },
  },
});

/**
 * SINGURUL loc din aplicație care decide unde trebuie să fie userul și singurul
 * care navighează pentru asta.
 *
 * Ce trebuie știut despre el:
 *  - CE rută e obligatorie → `resolveAppRoute` (poarta de auth, anketă, poze, umor);
 *  - DACĂ e nevoie de navigare → `navigationTarget` (userul poate fi deja acolo);
 *  - guard-ul doar execută.
 *
 * Ecranele NU decid nimic: login, register și quiz-ul trimit userul la `/`, iar
 * de acolo poarta îl duce; wizardul de anketă nici măcar atât — doar recitește
 * userul de pe server, iar poarta vede singură ce s-a schimbat. Înainte,
 * `index.tsx` avea propriul redirect, știa doar de `profile_completed` și ateriza
 * în feed peste userul care n-avea testul de umor — pe care serverul îl refuza
 * apoi la fiecare swipe.
 *
 * Exportat pentru teste: e logica de navigare a aplicației și merită verificată
 * direct, nu prin randarea întregului layout (fonturi, push, i18n).
 */
export function AuthGuard() {
  const segments = useSegments();
  const router = useRouter();
  const route = useAppRoute();
  const navigationRef = useNavigationContainerRef();

  /**
   * La PRIMA randare navigatorul NU e încă montat, oricât de devreme am ști
   * încotro trebuie dus userul: `NavigationContainer` se marchează „gata" într-un
   * efect propriu, iar efectele copiilor — poarta asta — rulează înaintea lui.
   * O navigare de acolo aruncă „Attempted to navigate before mounting the Root
   * Layout component", adică ecran roșu la pornire — se întâmplă exact când
   * sesiunea e deja hidratată la montare (SecureStore e mai rapid decât fonturile
   * și limba, care țin splash-ul).
   *
   * Așa că amânăm un tick. Nu se pierde nimic: userul e pe splash oricum.
   */
  const [navigatorMounted, setNavigatorMounted] = useState(false);
  useEffect(() => {
    setNavigatorMounted(true);
  }, []);

  useEffect(() => {
    if (!navigatorMounted || !navigationRef.isReady()) return;

    // expo-router 6 tipează `useSegments()` ca uniune de tuple literale (lungime ≥ 1),
    // deși pe ruta index chiar întoarce o listă goală. O privim ca listă de
    // string-uri ca să putem trata cazul real, fără `any`.
    const path: readonly string[] = segments;

    const target = navigationTarget(route, path);
    if (!target) return;

    // `dismissTo`, NU `replace`: poarta spune UNDE trebuie să fie userul, nu
    // „pune ecranul ăsta peste ce e acum". Diferența se vede când peste
    // aplicație e deschis cu `push` un ecran (quiz-ul din Setări, un story, un
    // chat): stiva rădăcină e atunci `[(tabs), humor]`, iar un `replace`
    // schimbă DOAR vârful — feed-ul de dedesubt rămâne montat și ajungem cu
    // `[(tabs), (tabs)]`, adică două ecrane de ankete unul peste altul (două
    // bare de story-uri, două carduri, două bare de taburi).
    // `dismissTo` se întoarce la ecranul care există deja în spate; dacă nu
    // există, se poartă exact ca `replace`.
    router.dismissTo(target);
  }, [navigatorMounted, navigationRef, route, segments, router]);

  return null;
}

export default function RootLayout() {
  const hydrate = useAuthStore((s) => s.hydrate);
  const [fontsLoaded] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_700Bold,
  });

  // Limba salvată se citește asincron (SecureStore). Ținem splash-ul până se
  // rezolvă, exact ca la fonturi: altfel un user rus ar vedea o clipă românește,
  // apoi textul ar sări. `initI18n` nu aruncă — cel mai rău caz rămâne `ro`.
  const [languageReady, setLanguageReady] = useState(false);

  useEffect(() => {
    let active = true;
    initI18n().finally(() => {
      if (active) setLanguageReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  if (!fontsLoaded || !languageReady) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <StatusBar style="auto" />
          <AuthGuard />
          {/* Notificări: handler, tap → ecran, sincronizarea tăcută a tokenului. */}
          <PushBridge />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(onboarding)" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="chat/[id]" />
            <Stack.Screen name="requests/[userId]" />
            <Stack.Screen name="profile/edit" />
            <Stack.Screen name="favorites" />
            <Stack.Screen name="ticket" />
            <Stack.Screen name="blocklist" />
            <Stack.Screen name="events/index" />
            <Stack.Screen name="events/[id]" />
            <Stack.Screen name="passport" />
            <Stack.Screen name="stories/[userId]" options={{ presentation: 'fullScreenModal' }} />
            <Stack.Screen name="stories/new" options={{ presentation: 'modal' }} />
            <Stack.Screen name="humor" options={{ presentation: 'modal' }} />
            <Stack.Screen name="paywall" options={{ presentation: 'modal' }} />
            <Stack.Screen name="verify-face" options={{ presentation: 'modal' }} />
          </Stack>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
