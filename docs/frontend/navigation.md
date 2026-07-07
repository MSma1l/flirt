# FLIRT — Structura de navigație (expo-router)

> Vezi și: [`README.md`](./README.md) · [`screens.md`](./screens.md) · [`styling.md`](./styling.md) · [`PROGRESS.md`](../../PROGRESS.md)
>
> Acest document a fost aliniat la rutele **reale** din `mobile/app/**`. Ecranele care apar în blueprint dar nu sunt încă implementate sunt marcate **🔜 Planificat**.

Navigația folosește **expo-router** (file-based, peste React Navigation). Arborele de fișiere din **`app/`** (la rădăcina `mobile/`, **nu** `src/app/`) **este** graful de navigație. Rutele sunt subțiri și compun ecrane din `src/features/*`.

---

## 1. Straturi de navigație (real)

| Grup / zonă | Rol | Tab bar vizibil? |
|---|---|---|
| `index` (root) | Splash + decizie de rutare (sesiune? anketă completă?) | nu |
| `(auth)` | `welcome`, `login`, `register` | nu |
| `(onboarding)` | Wizard anketă (un singur ecran multi-pas) | nu |
| `(tabs)` | Aplicația principală cu **3 taburi**: `ankete` · `mesaje` · `setari` | **da** |
| ecrane push (rădăcină) | `chat/[id]`, `profile/edit`, `favorites`, `ticket`, `blocklist`, `events/*`, `passport`, `stories/*` | nu (push peste taburi) |

---

## 2. Diagramă text a rutelor (real)

```
app/_layout.tsx  (Providers: ThemeProvider, react-query, fonturi Manrope, hidratare sesiune)
│
├── index.tsx ...................... SPLASH → verifică sesiunea + anketa
│        ├─ fără sesiune ──────────► (auth)/welcome
│        ├─ anketă incompletă ─────► (onboarding)
│        └─ totul OK ──────────────► (tabs)/ankete
│
├── (auth)/  [STACK, fără tab bar]
│     ├── welcome ................. alegere: login / register
│     ├── login .................. email + parolă
│     └── register ............... email + parolă (min 8)
│
├── (onboarding)/  [STACK]
│     └── index .................. wizard anketă multi-pas (opțiuni din backend)
│
├── (tabs)/  [TAB BAR — 3 taburi]
│     ├── ankete .................. Feed de swipe (default) + StoriesBar
│     ├── mesaje .................. Lista de dialoguri
│     └── setari .................. Hub setări + profil + linkuri
│
├── chat/[id].tsx ................. Ecran de conversație (push)
├── profile/edit.tsx ............. Editare anketă (push)
├── favorites.tsx ................ Lista de favorite (push)
├── ticket.tsx ................... Bilet Flirt Party (push)
├── blocklist.tsx ................ Black list / deblocare (push)
├── events/
│     ├── index.tsx .............. Listă evenimente (push)
│     └── [id].tsx ............... Detaliu eveniment + check-in (push)
├── passport.tsx ................. Flirt Passport — grid ștampile (push)
└── stories/
      ├── [userId].tsx ........... Vizualizator povești (push)
      └── new.tsx ................ Creare poveste prin URL (push)
```

---

## 3. Tab bar-ul (real — `app/(tabs)/_layout.tsx`)

Trei taburi; tabul de swipe (`ankete`) e primul/implicit:

| # | Rută | Etichetă | Iconiță | Scop (TZ) |
|---|---|---|---|---|
| 1 | `ankete` | Ankete | 🂠 | Feed de swipe (ecran default) — TZ 4 |
| 2 | `mesaje` | Mesaje | 💬 | Lista de dialoguri — TZ 5 |
| 3 | `setari` | Setări | ⚙️ | Profil, bilet, black list, setări — TZ 6 |

- Culorile (activ/inactiv, fundal, border) vin din `@theme` — niciun hex hardcodat.
- `headerShown: false`; iconițele sunt emoji-uri simple (placeholder).

Cod real (`app/(tabs)/_layout.tsx`):
```tsx
<Tabs screenOptions={{
  headerShown: false,
  tabBarActiveTintColor: colors.accent,
  tabBarInactiveTintColor: colors.textSecondary,
  tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
}}>
  <Tabs.Screen name="ankete" options={{ title: 'Ankete', tabBarIcon: ... }} />
  <Tabs.Screen name="mesaje" options={{ title: 'Mesaje', tabBarIcon: ... }} />
  <Tabs.Screen name="setari" options={{ title: 'Setări', tabBarIcon: ... }} />
</Tabs>
```

---

## 4. Prezentare & popup-uri

| Element | Prezentare (MVP) | Note |
|---|---|---|
| `(auth)`, `(onboarding)` | stack standard (push) | fără tab bar |
| `chat/[id]` | push la rădăcină | header cu numele interlocutorului |
| `events/*`, `passport`, `favorites`, `ticket`, `blocklist` | push la rădăcină, deschise din hub-ul Setări sau din feed | |
| `stories/[userId]`, `stories/new` | push | vizualizator cu bare de progres / creare prin URL |
| `MatchModal` „Connect!" | **overlay** peste feed (nu rută) | randat la match reciproc |
| `StoriesBar` | componentă integrată în feed (tab `ankete`) | intrare spre `stories/[userId]` |

**🔜 Planificat (din blueprint, neimplementat):** `paywall` (modal abonamente), `events/map` (hartă react-native-maps), `SendFirstMessageSheet` (bottom sheet la like — TZ 4.7), `AdInterstitial` (reclamă 15s), gesturi de swipe (Reanimated/gesture-handler — momentan butoane like/dislike).

---

## 5. Deep linking și notificări

**🔜 Planificat.** expo-router permite deep linking, dar push-urile (match nou, mesaj, AI-hint, sugestie eveniment) și maparea lor la rute nu sunt implementate în MVP. Realtime-ul din chat este **polling** (React Query), nu WebSocket.

---

## 6. Guard-uri de navigație (real)

Logica de rutare inițială e centralizată în `app/index.tsx` (splash) + hidratarea sesiunii din `_layout`:

1. **AuthGuard** — fără sesiune validă → `(auth)/welcome`.
2. **OnboardingGuard** — anketă incompletă (`profile_completed=false`) → `(onboarding)`.
3. Totul OK → `(tabs)/ankete`.

**🔜 Planificat:** `VerificationGuard` (verificare facială — TZ 2.2), `AgeGuard` explicit 16–17 / 18+ la nivel de UI (separarea pe vârstă se aplică deja în feed pe backend), `PremiumGuard` (paywall — TZ 9).

Starea vine din `authStore` (Zustand) + `@/services/api` (token store: access în memorie, refresh în SecureStore).
