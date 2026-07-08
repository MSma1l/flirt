/** Tab bar principal — 3 taburi (TZ secț. 3): Ankete · Mesaje · Setări. */
import { useQuery } from '@tanstack/react-query';
import { Tabs } from 'expo-router';
import React, { useEffect } from 'react';
import { Text } from 'react-native';

import { fetchChats } from '@/features/chat/chatApi';
import { ChatSummary } from '@/features/chat/types';
import { registerDevice } from '@/features/push/pushService';
import { useTheme } from '@theme/index';

function TabIcon({ icon, color }: { icon: string; color: string }) {
  return <Text style={{ fontSize: 22, color }}>{icon}</Text>;
}

export default function TabsLayout() {
  const { colors } = useTheme();

  // La intrarea în aplicație (după autentificare) înregistrăm device-ul pentru push.
  useEffect(() => {
    registerDevice();
  }, []);

  const { data: chats } = useQuery<ChatSummary[]>({
    queryKey: ['chats'],
    queryFn: fetchChats,
  });
  const unreadTotal = (chats ?? []).reduce(
    (sum: number, c: ChatSummary) => sum + c.unreadCount,
    0,
  );
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
          tabBarBadge: unreadTotal > 0 ? unreadTotal : undefined,
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
