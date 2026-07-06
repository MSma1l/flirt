/** Tab bar principal — 3 taburi (TZ secț. 3): Ankete · Mesaje · Setări. */
import { Tabs } from 'expo-router';
import React from 'react';
import { Text } from 'react-native';

import { useTheme } from '@theme/index';

function TabIcon({ icon, color }: { icon: string; color: string }) {
  return <Text style={{ fontSize: 22, color }}>{icon}</Text>;
}

export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
      }}
    >
      <Tabs.Screen
        name="ankete"
        options={{
          title: 'Ankete',
          tabBarIcon: ({ color }) => <TabIcon icon="🂠" color={color} />,
        }}
      />
      <Tabs.Screen
        name="mesaje"
        options={{
          title: 'Mesaje',
          tabBarIcon: ({ color }) => <TabIcon icon="💬" color={color} />,
        }}
      />
      <Tabs.Screen
        name="setari"
        options={{
          title: 'Setări',
          tabBarIcon: ({ color }) => <TabIcon icon="⚙️" color={color} />,
        }}
      />
    </Tabs>
  );
}
