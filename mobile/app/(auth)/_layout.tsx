/** Stack layout pentru fluxul de autentificare (fără header). */
import { Stack } from 'expo-router';
import React from 'react';

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
