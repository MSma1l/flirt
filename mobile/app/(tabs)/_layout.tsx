/** Tab bar principal — 3 taburi (TZ secț. 3): Ankete · Mesaje · Setări. */
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Tabs } from 'expo-router';
import React from 'react';

import { fetchChats } from '@/features/chat/chatApi';
import { ChatSummary } from '@/features/chat/types';
import { useTheme } from '@theme/index';

/**
 * Iconiță vectorială pentru tab (Ionicons). Varianta plină pe tab-ul activ,
 * outline pe cele inactive — ca la aplicațiile moderne. Culoarea vine din temă
 * prin `color` (accent pe activ, gri pe inactiv).
 */
function TabIcon({
  name,
  color,
  focused,
}: {
  name: 'flame' | 'chatbubble' | 'settings';
  color: string;
  focused: boolean;
}) {
  const iconName = (focused ? name : `${name}-outline`) as keyof typeof Ionicons.glyphMap;
  return <Ionicons name={iconName} size={24} color={color} />;
}

export default function TabsLayout() {
  const { colors } = useTheme();

  // Push-ul NU se mai înregistrează aici: token-ul se sincronizează tăcut în
  // `PushBridge` (layout-ul rădăcină), iar permisiunea se cere în tab-ul Mesaje,
  // când userul are deja conversații — nu la prima deschidere a aplicației.
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
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="flame" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="mesaje"
        options={{
          title: 'Mesaje',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="chatbubble" color={color} focused={focused} />
          ),
          tabBarBadge: unreadTotal > 0 ? unreadTotal : undefined,
        }}
      />
      <Tabs.Screen
        name="setari"
        options={{
          title: 'Setări',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="settings" color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}
