/** Root layout — providers globale (temă, react-query), fonturi, hidratare auth. */
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_700Bold,
  useFonts,
} from '@expo-google-fonts/manrope';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useHumorGate } from '@/features/humor/humorGate';
import { PushBridge } from '@/features/push/PushBridge';
// Importul inițializează instanța i18n (sincron, pe `ro`); `initI18n` comută
// apoi pe limba salvată de user sau pe cea a dispozitivului.
import { initI18n } from '@/i18n';
import { useAuthStore } from '@/store/authStore';
import { ThemeProvider } from '@theme/index';

const queryClient = new QueryClient();

/**
 * Guard reactiv de autentificare. Reacționează la schimbările din store
 * (login/logout, profile_completed) și redirecționează — mecanismul principal
 * de navigare de auth, spre deosebire de `index.tsx` care rulează doar la montare.
 *
 * Exportat pentru teste: e singura logică de navigare din aplicație și merită
 * verificată direct, nu prin randarea întregului layout (fonturi, push, i18n).
 */
export function AuthGuard() {
  const status = useAuthStore((s) => s.status);
  const profileCompleted = useAuthStore((s) => s.user?.profile_completed);
  const segments = useSegments();
  const router = useRouter();
  // Testul de umor e obligatoriu: fără vector de umor, scorul de compatibilitate
  // al userului iese slab. Poarta se închide DOAR când serverul confirmă că
  // datele lipsesc; dacă tace (500, rețea moartă), `needsQuiz` e `false` și
  // userul trece — vezi `humorGate.ts`.
  const { needsQuiz } = useHumorGate();

  useEffect(() => {
    // Splash: nu facem nimic până când starea nu e cunoscută.
    if (status === 'loading') return;

    // expo-router 6 tipează `useSegments()` ca uniune de tuple literale (lungime ≥ 1),
    // deși la cold-start, pe ruta index, chiar întoarce o listă goală. O privim ca
    // listă de string-uri ca să putem testa cazul real, fără `any`.
    const path: readonly string[] = segments;

    // Ruta index (splash) își gestionează singură redirect-ul la cold-start;
    // evităm redirecturi duble ieșind devreme când suntem pe ea.
    if (path.length === 0) return;

    const inAuth = path[0] === '(auth)';
    const inOnboarding = path[0] === '(onboarding)';
    const inHumor = path[0] === 'humor';

    if (status === 'unauthenticated') {
      if (!inAuth) router.replace('/(auth)/welcome');
      return;
    }

    // status === 'authenticated'
    if (!profileCompleted) {
      if (!inOnboarding) router.replace('/(onboarding)');
      return;
    }

    // Profil complet, dar fără date de umor → testul, oriunde ar fi userul
    // (prima înregistrare SAU login ulterior). Ieșirea devreme când e deja pe
    // quiz taie bucla quiz → feed → guard → quiz.
    if (needsQuiz) {
      if (!inHumor) router.replace('/humor');
      return;
    }

    // Autentificat cu profil complet: nu rămâne blocat în (auth)/(onboarding).
    if (inAuth || inOnboarding) router.replace('/(tabs)/ankete');
  }, [status, profileCompleted, needsQuiz, segments, router]);

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
