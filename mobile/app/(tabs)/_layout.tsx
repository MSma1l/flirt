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
 * Bara e FĂRĂ etichete (doar iconițe), așa că înălțimea = iconiță + aer.
 * Dacă schimbi mărimea iconiței, înălțimea barei se recalculează singură.
 */

/** Latura iconiței de tab (era 24 — userul le-a cerut de două ori mai mari). */
const TAB_ICON_SIZE = 48;
/**
 * Aer vertical de fiecare parte a iconiței, pus de react-navigation.
 * Cei 5px vin din `tabVerticalUiKit` (padding: 5) și NU pot fi schimbați prin
 * opțiuni publice: `tabBarItemStyle` ajunge pe containerul din AFARA butonului,
 * nu pe buton. Îi trecem aici ca să iasă socoteala înălțimii, nu ca să-i setăm.
 */
const TAB_ITEM_PADDING_RN = 5;
/** Aer în plus, pus de noi pe containerul itemului, ca bara să nu fie înghesuită. */
const TAB_ITEM_PADDING_EXTRA = 5;
/**
 * Înălțimea utilă a barei (fără safe area) = iconiță + aer sus/jos.
 * = 48 + 2×(5+5) = 68. Socoteala e EXACTĂ, adică butonul rămâne fix cât iconița:
 * așa iese iconița centrată vertical, deși react-navigation aliniază `flex-start`
 * (`marginVertical: 'auto'` de mai jos o ține centrată și dacă cifrele se schimbă).
 * Zona de atins = toată înălțimea barei → mult peste minimul de 44px (Apple HIG).
 */
const TAB_BAR_CONTENT_HEIGHT =
  TAB_ICON_SIZE + 2 * (TAB_ITEM_PADDING_RN + TAB_ITEM_PADDING_EXTRA);

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
        // Fără scris sub iconițe — doar iconița. `tabBarShowLabel` e DEPRECAT în
        // react-navigation v7; varianta corectă e `tabBarLabelVisibilityMode`.
        // Numele fiecărui tab rămâne pentru cititorul de ecran, prin
        // `tabBarAccessibilityLabel` (vezi mai jos) — obligatoriu, altfel bara
        // e mută pentru VoiceOver/TalkBack.
        tabBarLabelVisibilityMode: 'unlabeled',
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: TAB_BAR_CONTENT_HEIGHT + insets.bottom,
        },
        // Containerul iconiței e fix 31×28 în react-navigation; fără asta,
        // iconița de 48px ar da pe dinafară. Badge-ul de necitite e ancorat de
        // acest container, deci se așază singur pe colțul iconiței.
        tabBarIconStyle: {
          width: TAB_ICON_SIZE,
          height: TAB_ICON_SIZE,
          marginVertical: 'auto',
        },
        tabBarItemStyle: { paddingVertical: TAB_ITEM_PADDING_EXTRA },
      }}
    >
      <Tabs.Screen
        name="ankete"
        options={{
          title: 'Ankete',
          // „Ankete", nu „Anchete": în română *anchetă* înseamnă investigație.
          // Termenul consacrat al aplicației e „anketă" (chestionar/profil), iar
          // eticheta pentru VoiceOver trebuie să spună exact ce spune aplicația.
          tabBarAccessibilityLabel: 'Ankete',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="flame" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="mesaje"
        options={{
          title: 'Mesaje',
          tabBarAccessibilityLabel: 'Mesaje',
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
          tabBarAccessibilityLabel: 'Setări',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="settings" color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}
