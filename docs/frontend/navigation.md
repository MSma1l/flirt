# FLIRT — Structura de navigație (expo-router)

> Vezi și: [`README.md`](./README.md) · [`screens.md`](./screens.md) · [`styling.md`](./styling.md)

Navigația folosește **expo-router v3** (file-based, peste React Navigation). Arborele de fișiere din `src/app/` **este** graful de navigație. Rutele sunt subțiri (doar compun ecrane din `features/`).

---

## 1. Straturi de navigație

Aplicația are trei zone majore, separate prin grupuri de rute expo-router (folderele `(...)`):

| Grup / zonă | Rol | Tab bar vizibil? |
|---|---|---|
| `index` (root) | Splash + decizie de rutare (sesiune validă?) | nu |
| `(auth)` | Onboarding: login, verificare facială, wizard anketă | nu |
| `(tabs)` | Aplicația principală cu **tab bar de 3 taburi** (TZ secț. 3) | **da** |
| `events` | Stack evenimente (listă, detaliu, hartă, passport) — peste tab bar | parțial (modal/push) |
| `paywall` | Ecran modal de abonamente, invocabil de oriunde | nu (modal) |

---

## 2. Diagramă text a rutelor

```
Root (src/app/_layout.tsx)
│   Providers globali: QueryClientProvider, ThemeProvider,
│   I18nProvider, GestureHandlerRootView, SafeAreaProvider
│
├── index.tsx ................... SPLASH → verifică sesiunea
│        │
│        ├─ fără sesiune ──────────────► (auth)/welcome
│        ├─ neverificat facial ────────► (auth)/face-verify
│        ├─ anketă incompletă ─────────► (auth)/profile-setup/basics
│        └─ totul OK ──────────────────► (tabs)/deck
│
├── (auth)/  [STACK, fără tab bar]
│     ├── welcome ............... alegere metodă login
│     ├── sign-in .............. Apple / Google / phone / email
│     ├── otp .................. cod SMS/OTP (dacă login prin telefon)
│     ├── face-verify .......... liveness-check (selfie/video)
│     └── profile-setup/  [STACK imbricat — wizard multi-pas]
│           basics → location → photos → about →
│           interests → status → humor ──► (tabs)/deck
│
├── (tabs)/  [TAB BAR — 3 taburi]
│     │
│     ├── ┌─ Tab 1: "Ankete" (deck/) ──────────────┐  [default]
│     │   │   index ......... Swipe deck             │
│     │   │     └─ overlay: AdInterstitial (15s)     │
│     │   │     └─ overlay: ConnectPopup (match)     │
│     │   └────────────────────────────────────────┘
│     │
│     ├── ┌─ Tab 2: "Mesaje" (messages/) ──────────┐
│     │   │   index ......... Lista de dialoguri     │
│     │   │   [chatId] ...... Ecran de chat  (push)  │
│     │   └────────────────────────────────────────┘
│     │
│     └── ┌─ Tab 3: "Setări" (settings/) ──────────┐
│         │   index ......... Meniu setări + profil  │
│         │   profile-edit .. Editare anketă  (push) │
│         │   favorites ..... Anketă favorite (push) │
│         │   ticket ........ Bilet Flirt Party(push)│
│         │   subscription .. Gestiune abonament→ Paywall
│         │   preferences ... Temă/notif/radius (push)│
│         └────────────────────────────────────────┘
│
├── events/  [STACK, deschis din deck event-badge / chat banner / notificare]
│     ├── index ............... Listă evenimente
│     ├── [eventId] ........... Detaliu eveniment ("Tot iau parte")
│     ├── map ................. Live Events Map
│     └── passport ............ Flirt Passport (ștampile)
│
└── paywall.tsx  [MODAL global]  ← invocat din deck (limită depășită),
                                    settings/subscription, sau orice CTA premium
```

---

## 3. Tab bar-ul (TZ secțiunea 3)

Definit în `src/app/(tabs)/_layout.tsx`. Trei taburi, tabul de swipe e cel implicit:

| # | Rută | Etichetă (i18n) | Iconiță | Scop (TZ) |
|---|---|---|---|---|
| 1 | `deck` | Ankete | stivă de carduri | Lenta de swipe (ecran default) — TZ 4 |
| 2 | `messages` | Mesaje | bulă de chat | Lista de dialoguri + AI-hints — TZ 5 |
| 3 | `settings` | Setări | roată/profil | Profil, foto, bilet Flirt Party, setări — TZ 6 |

Caracteristici tab bar:
- Culorile (activ/inactiv, fundal) vin din `@theme` — niciun hex hardcodat (vezi [`styling.md`](./styling.md)).
- Tab 2 afișează un **badge de mesaje necitite** (din `chat` store).
- Tab bar-ul se **ascunde** pe ecranele din `(auth)`, `events` și pe `paywall`.

Schiță `(tabs)/_layout.tsx`:
```tsx
// Ilustrativ — nu cod final de producție
import { Tabs } from 'expo-router';
import { useTheme } from '@theme';
import { TabIcon } from '@components';

export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen name="deck"     options={{ title: t('tabs.deck'),     tabBarIcon: p => <TabIcon name="cards" {...p} /> }} />
      <Tabs.Screen name="messages" options={{ title: t('tabs.messages'), tabBarIcon: p => <TabIcon name="chat"  {...p} /> }} />
      <Tabs.Screen name="settings" options={{ title: t('tabs.settings'), tabBarIcon: p => <TabIcon name="gear"  {...p} /> }} />
    </Tabs>
  );
}
```

---

## 4. Stack-uri și moduri de prezentare

| Stack / ecran | Prezentare | Note |
|---|---|---|
| `(auth)` | stack standard (push) | fără gest de swipe-back pe pașii critici (face-verify) |
| `profile-setup/*` | stack imbricat cu progres | bara de progres pe pași; draft persistat local |
| `messages/[chatId]` | push în stack-ul tabului Mesaje | header cu foto + Compatibility Score |
| `events/*` | stack modal/push | intrare din event-badge (deck), banner chat, notificare |
| `events/map` | full-screen | `react-native-maps` |
| `paywall` | **modal** (`presentation: 'modal'`) | invocabil global; se închide cu swipe-down |
| `ConnectPopup` (match) | **overlay full-screen** (nu rută separată) | randat peste deck la eveniment socket |
| `AdInterstitial` (15s) | **overlay** peste deck | apare după 10 ankete la userii free |
| `SendFirstMessageSheet` | **bottom sheet** | apare la swipe-right (like) — TZ 4.7 |

> Popup-urile efemere (match, reclamă, sheet de primul mesaj) **nu** sunt rute în `app/`. Sunt componente din feature-urile lor (`match`, `swipe`), controlate prin state, ca să nu polueze istoricul de navigație și să poată fi animate cu Reanimated.

---

## 5. Deep linking și navigație din notificări

expo-router mapează automat rutele la URL-uri, ceea ce permite deep linking pentru push-urile din TZ:

| Sursă push (TZ) | Destinație | Exemplu link |
|---|---|---|
| Match nou (4.7) | `messages/[chatId]` sau ConnectPopup | `flirt://messages/abc123` |
| Mesaj nou (5) | `messages/[chatId]` | `flirt://messages/abc123` |
| AI-hint "reia conversația" (5.3) | `messages/[chatId]` | `flirt://messages/abc123` |
| Sugestie eveniment (5.3 / 8) | `events/[eventId]` | `flirt://events/xyz789` |
| Notificare bot → hartă (8.3) | `events/map` | `flirt://events/map` |

Redirecturile de la `index.tsx` (sesiune / verificare / anketă incompletă) garantează că un deep link nu duce un user neautentificat direct în aplicație.

---

## 6. Guard-uri de navigație

Logica de "unde poate merge userul" e centralizată, nu împrăștiată prin ecrane:

1. **AuthGuard** (în `index.tsx` + `_layout` root): fără sesiune → `(auth)`.
2. **VerificationGuard**: cont neverificat facial → vizibilitate limitată; anumite acțiuni redirectează la `(auth)/face-verify` (TZ 2.2).
3. **OnboardingGuard**: anketă incompletă → wizard `profile-setup`.
4. **AgeGuard**: userii 16–17 nu au acces la conținut/filtre 18+ (TZ 2.3) — aplicat la nivel de deck și filtre, nu ca rută separată.
5. **PremiumGuard**: acțiuni premium (undo nelimitat, swipe fără limită) → `paywall` dacă userul e free (TZ 9).

Starea folosită de guard-uri vine din `sessionStore` (`@store`), verificată în layout-uri.
