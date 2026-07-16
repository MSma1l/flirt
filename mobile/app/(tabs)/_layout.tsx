/** Tab bar principal — 3 taburi (TZ secț. 3): Ankete · Mesaje · Setări. */
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Tabs } from 'expo-router';
import React from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchChats } from '@/features/chat/chatApi';
import { ChatSummary } from '@/features/chat/types';
import { useTheme } from '@theme/index';

/**
 * Dimensiunile barei de taburi — TOATE derivă din `TAB_ICON_SIZE`.
 * Dacă schimbi mărimea iconiței, înălțimea barei se recalculează singură,
 * ca să nu rămână iconița tăiată sau eticheta înghesuită.
 */

/** Latura iconiței de tab (era 24 — userul le-a cerut de două ori mai mari). */
const TAB_ICON_SIZE = 48;
/** Înălțimea rândului de etichetă (fontSize 13 × ~1.25). */
const TAB_LABEL_LINE_HEIGHT = 16;
/** Mărimea textului etichetei — 10px (default) e prea mic lângă o iconiță de 48. */
const TAB_LABEL_FONT_SIZE = 13;
/** Aer sus/jos în interiorul fiecărui tab (react-navigation pune 5 implicit). */
const TAB_ITEM_VERTICAL_PADDING = 6;
/**
 * Înălțimea utilă a barei (fără safe area): iconiță + etichetă + aer.
 * = 48 + 16 + 12 = 76 → și zonă de atins mult peste minimul de 44px (Apple HIG).
 */
const TAB_BAR_CONTENT_HEIGHT =
  TAB_ICON_SIZE + TAB_LABEL_LINE_HEIGHT + TAB_ITEM_VERTICAL_PADDING * 2;

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
  return <Ionicons name={iconName} size={TAB_ICON_SIZE} color={color} />;
}

export default function TabsLayout() {
  const { colors } = useTheme();
  // Insetul de jos (bara gestuală de pe iPhone / navigarea prin gesturi pe
  // Android; 0 pe web). react-navigation îl adaugă singur la înălțime DOAR dacă
  // nu-i dăm noi un `height` fix — cum îi dăm, trebuie să-l adunăm manual,
  // altfel bara ar sta peste bara gestuală.
  const insets = useSafeAreaInsets();

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
          height: TAB_BAR_CONTENT_HEIGHT + insets.bottom,
        },
        // Containerul iconiței e fix 31×28 în react-navigation; fără asta,
        // iconița de 48px ar da pe dinafară peste etichetă.
        tabBarIconStyle: { width: TAB_ICON_SIZE, height: TAB_ICON_SIZE },
        tabBarItemStyle: { paddingVertical: TAB_ITEM_VERTICAL_PADDING },
        tabBarLabelStyle: {
          fontSize: TAB_LABEL_FONT_SIZE,
          lineHeight: TAB_LABEL_LINE_HEIGHT,
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
