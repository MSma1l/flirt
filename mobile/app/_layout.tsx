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
import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuthStore } from '@/store/authStore';
import { ThemeProvider } from '@theme/index';

const queryClient = new QueryClient();

/**
 * Guard reactiv de autentificare. Reacționează la schimbările din store
 * (login/logout, profile_completed) și redirecționează — mecanismul principal
 * de navigare de auth, spre deosebire de `index.tsx` care rulează doar la montare.
 */
function AuthGuard() {
  const status = useAuthStore((s) => s.status);
  const profileCompleted = useAuthStore((s) => s.user?.profile_completed);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    // Splash: nu facem nimic până când starea nu e cunoscută.
    if (status === 'loading') return;

    // Ruta index (splash) își gestionează singură redirect-ul la cold-start;
    // evităm redirecturi duble ieșind devreme când suntem pe ea.
    if (segments.length === 0) return;

    const inAuth = segments[0] === '(auth)';
    const inOnboarding = segments[0] === '(onboarding)';

    if (status === 'unauthenticated') {
      if (!inAuth) router.replace('/(auth)/welcome');
      return;
    }

    // status === 'authenticated'
    if (!profileCompleted) {
      if (!inOnboarding) router.replace('/(onboarding)');
      return;
    }

    // Autentificat cu profil complet: nu rămâne blocat în (auth)/(onboarding).
    if (inAuth || inOnboarding) router.replace('/(tabs)/ankete');
  }, [status, profileCompleted, segments, router]);

  return null;
}

export default function RootLayout() {
  const hydrate = useAuthStore((s) => s.hydrate);
  const [fontsLoaded] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_700Bold,
  });

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <StatusBar style="auto" />
          <AuthGuard />
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
          </Stack>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
