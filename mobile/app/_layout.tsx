/** Root layout — providers globale (temă, react-query), fonturi, hidratare auth. */
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_700Bold,
  useFonts,
} from '@expo-google-fonts/manrope';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuthStore } from '@/store/authStore';
import { ThemeProvider } from '@theme/index';

const queryClient = new QueryClient();

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
          </Stack>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
