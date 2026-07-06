/** Layout onboarding — stack fără header (wizardul își desenează propriul progres). */
import { Stack } from 'expo-router';
import React from 'react';

export default function OnboardingLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
