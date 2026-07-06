# FLIRT — Arhitectură Frontend (React Native + Expo)

> Documentația arhitecturii aplicației mobile FLIRT — "No Regrets".
> Text explicativ în română, cod și denumiri în engleză.

Fișiere înrudite:
- [`navigation.md`](./navigation.md) — structura de navigație (tab bar + stack-uri).
- [`screens.md`](./screens.md) — toate ecranele mapate pe TZ.
- [`styling.md`](./styling.md) — principiul "stiluri separate de cod" + theming.

---

## 1. Stack tehnologic

| Domeniu | Alegere | Justificare |
|---|---|---|
| Runtime / build | **Expo SDK 51+** (managed workflow) | Build OTA, EAS Build/Submit pentru iOS și Android dintr-un singur codebase, config prin `app.config.ts`. TZ cere iOS 15+ și Android 9 (API 28)+ — acoperit nativ de Expo. Modul _prebuild_ rămâne disponibil dacă un modul nativ (ex. face-matching, camera liveness) cere cod custom. |
| Limbaj | **TypeScript** (strict mode) | Contractele de date (anketă, match, chat, events) sunt complexe; tipurile previn erori la nivel de UI și la integrarea cu API. |
| Navigație | **expo-router v3** (file-based, peste React Navigation) | Rutare declarativă bazată pe fișiere, deep linking gratuit (necesar pentru push-uri "revino în chat", invitații la evenimente), suport nativ pentru tab-uri + stack-uri imbricate. React Navigation rămâne motorul dedesubt, deci avem acces la API-urile lui când e nevoie. |
| State global (client) | **Zustand** | Store-uri mici, feature-based, fără boilerplate. Ideal pentru state efemer de UI (deck-ul de swipe, sesiunea, tema, filtrele). Preferat față de Redux Toolkit pentru că aplicația nu are un graf de state monolitic — fiecare feature își ține slice-ul lui. |
| State server (API) | **TanStack Query (React Query) v5** | Cache, revalidare, paginare (porția de 10 ankete), retry, optimistic updates la like/dislike. Separă clar datele de server de state-ul de client. |
| Gesturi + animații | **react-native-gesture-handler** + **react-native-reanimated v3** | Swipe deck-ul (stânga/dreapta/sus), long-press pentru favorite, animații pe UI thread (60fps) fără a bloca JS thread-ul. Standardul de facto pentru mecanica de tip Tinder. |
| Formulare | **react-hook-form** + **zod** | Onboarding-ul are multe câmpuri obligatorii (2.4–2.7). `zod` validează și e reutilizat pentru tipuri. |
| Networking | **axios** (client centralizat) + interceptori | Injectare token, refresh, mascarea erorilor. Consumat exclusiv prin React Query. |
| Storage local | **expo-secure-store** (tokenuri) + **@react-native-async-storage/async-storage** (preferințe) + **MMKV** opțional (cache rapid) | Tokenurile de auth stau criptat; preferințele (tema, notificări) în storage simplu. |
| Realtime chat | **socket.io-client** (sau WebSocket nativ) | Mesaje live, indicator online/typing, livrarea mesajelor amânate la match. |
| Hărți | **react-native-maps** (Google/Apple provider) | Ecranul Live Events Map (TZ 8.3). |
| Media / cameră | **expo-camera**, **expo-image-picker**, **expo-image** | Selfie liveness (2.2), încărcare fotografii anketă (min 3 / max 9), randare performantă a cardurilor full-screen. |
| Notificări | **expo-notifications** | Push pentru match, mesaje, AI-hints, evenimente, reclame (6.3). |
| Plăți / abonamente | **expo-in-app-purchases** sau **react-native-purchases (RevenueCat)** | Paywall și tipurile de abonament din TZ secțiunea 9. |
| i18n | **i18next** + **react-i18next** | RU / RO / EN (TZ 12 — localizare UI). Nu hardcodăm string-uri. |
| Testare | **Jest** + **@testing-library/react-native**, **Detox** (E2E) | Unit + component + fluxuri critice (onboarding, swipe, match). |
| Calitate cod | **ESLint** + **Prettier** + **TypeScript** în CI | Consistență și prevenirea regresiilor. |

### De ce Expo și nu bare React Native / nativ Swift+Kotlin?
TZ (1.2) lasă alegerea la latitudinea echipei ("на усмотрение разработки"). Expo oferă:
- un singur codebase pentru iOS + Android → viteză de livrare;
- EAS Build/Update pentru release-uri rapide și config remote;
- ecosistem de module native gata făcute (cameră, hărți, notificări, IAP).
Pentru pașii care cer cod nativ special (liveness-check, SDK face-matching) folosim **config plugins** / **development build**, fără a pierde beneficiile managed workflow.

---

## 2. Principii de arhitectură

1. **Feature-based, nu type-based.** Codul e grupat pe funcționalitate de business (`swipe`, `chat`, `events`), nu pe tip tehnic. Fiecare feature e (aproape) autonom: componente, hooks, store, servicii, tipuri proprii.
2. **Stiluri separate de cod.** Nicio culoare/spacing hardcodat în componente. Totul vine din `theme/`. Vezi [`styling.md`](./styling.md).
3. **Rutele sunt subțiri.** Fișierele din `app/` (expo-router) doar compun ecrane din `features/*/screens`. Fără logică de business în rute.
4. **State server ≠ state client.** Datele de la API trec exclusiv prin React Query; Zustand ține doar state efemer de UI.
5. **UI reutilizabil izolat.** `components/` conține doar primitive fără logică de domeniu (Button, Card, Avatar, Badge). Componentele cu logică de business stau în feature-ul lor.
6. **Un singur punct de acces la platformă.** Camera, storage, geo, push — toate în `services/`, ca să fie ușor de mock-uit și înlocuit.

---

## 3. Structura de foldere (arbore complet)

```
flirt/
├── app.config.ts               # config Expo (nume, iconițe, plugins, env)
├── eas.json                    # profile EAS Build/Submit
├── tsconfig.json               # path aliases (@features, @components, @theme...)
├── package.json
│
├── assets/                     # asset-uri statice (imagini, fonturi, lottie)
│   ├── fonts/                  # Manrope (Regular/Medium/SemiBold/Bold)
│   ├── images/                 # logo splash, placeholdere, iconițe interese
│   └── animations/             # lottie: match "Connect!", empty states
│
├── src/
│   │
│   ├── app/                    # === RUTE (expo-router, file-based) ===
│   │   ├── _layout.tsx         # root layout: providers (Query, theme, i18n, gesture)
│   │   ├── index.tsx           # redirect după verificarea sesiunii (splash logic)
│   │   ├── (auth)/             # stack de onboarding (fără tab bar)
│   │   │   ├── _layout.tsx
│   │   │   ├── welcome.tsx         # alegere metodă de login
│   │   │   ├── sign-in.tsx         # Apple / Google / phone / email
│   │   │   ├── otp.tsx             # cod SMS/OTP
│   │   │   ├── face-verify.tsx     # liveness-check (selfie/video)
│   │   │   └── profile-setup/      # wizard anketă (multi-pas)
│   │   │       ├── _layout.tsx
│   │   │       ├── basics.tsx      # nume, dată naștere, gen, înălțime
│   │   │       ├── location.tsx    # oraș, stradă/cartier
│   │   │       ├── photos.tsx      # 3–9 fotografii
│   │   │       ├── about.tsx       # despre, limbi, naționalitate
│   │   │       ├── interests.tsx   # multiselect interese
│   │   │       ├── status.tsx      # status de cunoștință
│   │   │       └── humor.tsx       # test simț al umorului (5–7 carduri)
│   │   │
│   │   ├── (tabs)/             # === TAB BAR (3 taburi, TZ secț. 3) ===
│   │   │   ├── _layout.tsx         # definirea tab bar-ului
│   │   │   ├── deck/               # Tab 1: "Ankete" (swipe)
│   │   │   │   ├── _layout.tsx
│   │   │   │   └── index.tsx       # ecranul de swipe
│   │   │   ├── messages/           # Tab 2: "Mesaje"
│   │   │   │   ├── _layout.tsx
│   │   │   │   ├── index.tsx       # lista de dialoguri
│   │   │   │   └── [chatId].tsx    # ecranul de chat
│   │   │   └── settings/           # Tab 3: "Setări"
│   │   │       ├── _layout.tsx
│   │   │       ├── index.tsx       # meniu setări + profil
│   │   │       ├── profile-edit.tsx
│   │   │       ├── favorites.tsx
│   │   │       ├── ticket.tsx      # bilet Flirt Party (QR)
│   │   │       ├── subscription.tsx
│   │   │       └── preferences.tsx # temă, notificări, radius, blocaje
│   │   │
│   │   ├── events/             # stack evenimente (peste tab bar / modal)
│   │   │   ├── _layout.tsx
│   │   │   ├── index.tsx           # listă evenimente
│   │   │   ├── [eventId].tsx       # detaliu eveniment ("Tot iau parte")
│   │   │   ├── map.tsx             # Live Events Map
│   │   │   └── passport.tsx        # Flirt Passport (ștampile)
│   │   │
│   │   ├── paywall.tsx         # ecran modal Paywall (abonamente)
│   │   └── +not-found.tsx
│   │
│   ├── features/               # === LOGICA DE BUSINESS, pe feature ===
│   │   ├── auth/
│   │   │   ├── screens/            # componente de ecran (fără rute)
│   │   │   ├── components/         # SocialButton, OtpInput, LivenessCamera...
│   │   │   ├── hooks/              # useSignIn, useOtp, useFaceVerify
│   │   │   ├── api/                # apeluri auth (consumate de React Query)
│   │   │   ├── store/              # auth store (Zustand): sesiune, tokeni
│   │   │   ├── styles/             # stiluri specifice feature-ului
│   │   │   └── types.ts
│   │   ├── onboarding/            # wizard-ul de anketă (profile-setup)
│   │   │   ├── screens/
│   │   │   ├── components/         # StepProgress, InterestChip, HumorCard...
│   │   │   ├── hooks/              # useProfileDraft (persistat local)
│   │   │   ├── store/              # draft-ul anketei între pași
│   │   │   ├── styles/
│   │   │   └── types.ts
│   │   ├── swipe/
│   │   │   ├── screens/            # DeckScreen
│   │   │   ├── components/         # SwipeCard, PhotoStories, CompatBadge,
│   │   │   │                       #   EventBadge, ActionBar, AdInterstitial
│   │   │   ├── hooks/              # useSwipeGestures, useDeckQueue, useSwipeLimit
│   │   │   ├── api/                # fetch deck, like/dislike, favorite, undo
│   │   │   ├── store/              # deck store: index curent, limită 10, favorite
│   │   │   ├── styles/
│   │   │   └── types.ts
│   │   ├── match/
│   │   │   ├── components/         # ConnectPopup, SendFirstMessageSheet
│   │   │   ├── hooks/              # useMatch
│   │   │   ├── styles/
│   │   │   └── types.ts
│   │   ├── chat/
│   │   │   ├── screens/            # ChatListScreen, ChatScreen
│   │   │   ├── components/         # ChatRow, MessageBubble, AiHintBanner,
│   │   │   │                       #   EventSuggestionBanner, QuickReplies,
│   │   │   │                       #   MaskedContactHint, ChatHeader
│   │   │   ├── hooks/              # useChatSocket, useMessages, useAiHints
│   │   │   ├── api/
│   │   │   ├── store/              # unread, typing, drafts
│   │   │   ├── styles/
│   │   │   └── types.ts
│   │   ├── profile/
│   │   │   ├── screens/            # ProfileEdit, PublicProfile, Favorites
│   │   │   ├── components/         # PhotoGrid, FieldEditor, StatusPicker
│   │   │   ├── hooks/
│   │   │   ├── api/
│   │   │   ├── styles/
│   │   │   └── types.ts
│   │   ├── events/
│   │   │   ├── screens/            # EventsList, EventDetail, EventsMap, Passport
│   │   │   ├── components/         # EventCard, MapMarker, PassportStamp
│   │   │   ├── hooks/              # useEvents, useEventsMap, useAttend
│   │   │   ├── api/
│   │   │   ├── styles/
│   │   │   └── types.ts
│   │   ├── settings/
│   │   │   ├── screens/            # SettingsMenu, Preferences, Ticket
│   │   │   ├── components/         # SettingRow, ThemeSelector, TicketQr
│   │   │   ├── hooks/
│   │   │   ├── styles/
│   │   │   └── types.ts
│   │   └── subscription/
│   │       ├── screens/            # PaywallScreen
│   │       ├── components/         # PlanCard, FeatureRow
│   │       ├── hooks/              # usePurchases, useEntitlements
│   │       ├── api/
│   │       ├── styles/
│   │       └── types.ts
│   │
│   ├── components/             # === UI REUTILIZABIL (fără logică de domeniu) ===
│   │   ├── Button/
│   │   │   ├── Button.tsx
│   │   │   ├── Button.styles.ts    # stil separat de cod
│   │   │   └── index.ts
│   │   ├── Text/                   # wrapper tipografic (folosește theme)
│   │   ├── Card/
│   │   ├── Avatar/
│   │   ├── Badge/                  # inclusiv varianta procent compatibilitate
│   │   ├── Chip/                   # tag/interes
│   │   ├── Sheet/                  # bottom sheet
│   │   ├── Modal/
│   │   ├── Input/
│   │   ├── Icon/                   # wrapper peste set de iconițe
│   │   ├── ProgressDots/           # indicatori foto tip Stories
│   │   └── index.ts
│   │
│   ├── theme/                  # === STILURI SEPARATE (single source of truth) ===
│   │   ├── colors.ts               # tokens dark + light (din DESIGN_TOKENS.md)
│   │   ├── typography.ts           # Manrope: familii, mărimi, greutăți
│   │   ├── spacing.ts              # scală de spacing + radius
│   │   ├── shadows.ts              # umbre (inclusiv glow roz accent)
│   │   ├── gradients.ts            # gradient CTA roz
│   │   ├── theme.ts                # asamblare lightTheme / darkTheme
│   │   ├── ThemeProvider.tsx       # context + hook useTheme()
│   │   └── index.ts
│   │
│   ├── services/              # === ACCES LA PLATFORMĂ / EXTERIOR ===
│   │   ├── api/
│   │   │   ├── client.ts           # instanță axios + interceptori
│   │   │   ├── queryClient.ts      # config React Query
│   │   │   └── endpoints.ts        # constante rute API
│   │   ├── auth/                   # login social, token refresh
│   │   ├── storage/                # secure-store + async-storage wrappers
│   │   ├── socket/                 # conexiune realtime chat
│   │   ├── location/               # geolocație, permisiuni, geocoding
│   │   ├── notifications/          # expo-notifications setup + handlere
│   │   ├── camera/                 # liveness + image picker helpers
│   │   ├── purchases/              # IAP / RevenueCat
│   │   └── ads/                    # SDK reclame (interstitial 15s)
│   │
│   ├── store/                 # === STATE GLOBAL (Zustand) transversal ===
│   │   ├── sessionStore.ts         # user curent, status verificare, entitlements
│   │   ├── themeStore.ts           # light/dark/system
│   │   ├── filtersStore.ts         # radius, gen, vârstă, limbi
│   │   └── index.ts
│   │
│   ├── hooks/                 # === HOOKS TRANSVERSALE (nu de feature) ===
│   │   ├── useAppState.ts
│   │   ├── useDebounce.ts
│   │   ├── useKeyboard.ts
│   │   └── usePermissions.ts
│   │
│   ├── utils/                 # === FUNCȚII PURE, fără efecte ===
│   │   ├── haversine.ts            # distanță între coordonate (TZ 7)
│   │   ├── compatibility.ts        # helper afișare % + culoare badge
│   │   ├── format.ts               # date, distanțe, ore
│   │   ├── validators.ts           # scheme zod partajate
│   │   └── maskContacts.ts         # helper UI pentru mascarea contactelor
│   │
│   ├── types/                 # === TIPURI GLOBALE partajate ===
│   │   ├── models.ts               # User, Profile, Match, Chat, Event, Ticket
│   │   ├── api.ts                  # request/response DTOs
│   │   └── navigation.ts           # tipuri rute expo-router
│   │
│   ├── i18n/                  # === LOCALIZARE (RU / RO / EN) ===
│   │   ├── index.ts
│   │   └── locales/
│   │       ├── ru.json
│   │       ├── ro.json
│   │       └── en.json
│   │
│   └── config/               # === CONFIG APP ===
│       ├── env.ts                  # variabile de mediu tipizate
│       ├── featureFlags.ts         # remote config (ex. ponderi score, limite)
│       └── constants.ts            # SWIPE_LIMIT=10, AD_TIMER=15s etc.
│
├── __tests__/                 # teste unit/component
└── e2e/                       # teste Detox (onboarding, swipe, match)
```

### Reguli de import (path aliases)
Configurate în `tsconfig.json` + `babel.config.js`:
```
@app/*        → src/app/*
@features/*   → src/features/*
@components/*  → src/components/*
@theme        → src/theme
@services/*    → src/services/*
@store/*       → src/store/*
@hooks/*       → src/hooks/*
@utils/*       → src/utils/*
@types/*       → src/types/*
```
Astfel importurile rămân stabile și lizibile: `import { useTheme } from '@theme'`.

### Regula de dependențe între straturi
```
app/  →  features/  →  components/ + services/ + store/ + theme/ + utils/
```
- `app/` (rute) importă din `features/`, dar `features/` NU importă din `app/`.
- `components/` (UI pur) NU importă din `features/` (ar crea dependențe circulare).
- `theme/`, `utils/`, `types/` sunt frunze: nu depind de nimic de business.

---

## 4. Fluxul de date (pe scurt)

```
UI (feature screen)
   │  citește / mutează
   ├──► React Query hooks  ──► services/api/client (axios)  ──► Backend REST
   │        (cache server state, retry, paginare)
   │
   ├──► Zustand store       (state efemer de client: deck index, tema, filtre)
   │
   └──► services/socket     (mesaje realtime, typing, match live)
```
- **Citirea listei de ankete**: React Query cu paginare de 10 (`useDeckQueue`).
- **Like/Dislike**: mutație optimistă (cardul dispare instant, rollback la eroare).
- **Match live**: eveniment prin socket → deschide `ConnectPopup` (feature `match`).
- **Chat**: mesaje via socket, istoric via React Query (infinite query).

---

## 5. Concluzie
Arhitectura e **feature-based**, cu **rute subțiri** (expo-router), **state server** izolat (React Query) de **state client** (Zustand), și **stiluri complet separate de cod** în `theme/`. Fiecare capitol din TZ are un feature dedicat, iar accesul la platformă (cameră, geo, push, plăți, reclame) e centralizat în `services/`, ușor de testat și de înlocuit.
