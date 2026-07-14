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
| `(auth)` | `welcome`, `login`, `register`, `phone` (OTP) | nu |
| `(onboarding)` | Wizard anketă (un singur ecran multi-pas) | nu |
| `(tabs)` | Aplicația principală cu **3 taburi**: `ankete` · `mesaje` · `setari` | **da** |
| ecrane push (rădăcină) | `chat/[id]`, `profile/edit`, `favorites`, `ticket`, `blocklist`, `events/*`, `passport` | nu (push peste taburi) |
| ecrane modale (rădăcină) | `humor`, `paywall`, `verify-face`, `stories/*` | nu (`presentation: 'modal'` / `'fullScreenModal'`) |

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
│     ├── welcome ................. Google / Apple (⚠ stub) · telefon · login / register
│     ├── login .................. email + parolă
│     ├── register ............... email + parolă (min 8)
│     └── phone .................. număr + cod OTP
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
├── humor.tsx .................... Test de umor (carduri glume, MODAL; link din Setări)
├── paywall.tsx .................. Abonamente (MODAL; ⚠ fără IAP nativ — vezi README §6)
├── verify-face.tsx .............. Verificare prin selfie (MODAL; ⚠ stub, fără cameră)
└── stories/
      ├── [userId].tsx ........... Vizualizator povești (fullScreenModal)
      └── new.tsx ................ Creare poveste prin URL (modal)
```

> **Tot ce e sub `(tabs)` în arbore se deschide din tabul `setari`.** Vezi §3.

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

### ⚠️ Setări = singurul hub de navigare

Cele 3 taburi acoperă doar feed, mesaje și setări. **Restul ecranelor sunt accesibile EXCLUSIV prin lista de linkuri din `setari`:**

`profile/edit` · `verify-face` · `paywall` · `humor` · `favorites` · `events` · `passport` · `ticket` · `blocklist`

Dacă ștergi sau reorganizezi acele rânduri, **nouă ecrane implementate rămân inaccesibile din UI** — rutele continuă să existe, dar nimic nu mai duce la ele.

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
| `events/*`, `passport`, `favorites`, `ticket`, `blocklist`, `profile/edit` | push la rădăcină, deschise din hub-ul Setări | |
| `humor`, `paywall`, `verify-face` | **modal** (`presentation: 'modal'`) | toate trei se deschid din hub-ul Setări |
| `stories/[userId]` | **fullScreenModal** | vizualizator cu bare de progres |
| `stories/new` | **modal** | creare prin URL media |
| `MatchModal` „Connect!" | **overlay** peste feed (nu rută) | randat la match reciproc |
| `StoriesBar` | componentă integrată în feed (tab `ankete`) | intrare spre `stories/[userId]` |
| `SendFirstMessageSheet` | **bottom sheet** la like (nu rută) | mesaj deferred la like (TZ 4.7) |
| `ReportModal` | **overlay** din chat + de pe card (nu rută) | raportare → `POST /reports/` |
| Gesturi de swipe | `PanResponder` + `Animated` în tab `ankete` | drag stânga/dreapta like/dislike (**fără** Reanimated / gesture-handler) |

**🔜 Planificat (neimplementat):** ruta `events/map` (Live Events Map cu contor de useri) — harta reală **există deja** (WebView + Leaflet + tiles OSM, fără cheie API), dar doar în detaliul unui eveniment (`events/[id]`); `AdInterstitial` (reclamă 15s); favorite/swipe-up direct din deck.

---

## 5. Deep linking și notificări

**🔜 Planificat.** expo-router permite deep linking, dar push-urile (match nou, mesaj, AI-hint, sugestie eveniment) și maparea lor la rute nu sunt implementate în MVP. Realtime-ul din chat este **polling** (React Query), nu WebSocket.

---

## 6. Guard-uri de navigație (real)

Rutarea de auth are **două** mecanisme, complementare:

1. **`app/index.tsx`** (splash) — decide redirect-ul la **cold-start**, o singură dată, la montare.
2. **`AuthGuard` din `app/_layout.tsx`** — componentă **reactivă**, montată permanent: ascultă `authStore` (`status`, `user.profile_completed`) și redirecționează la **orice** schimbare (login, logout, finalizarea anketei). Ăsta e mecanismul principal — `index.tsx` acoperă doar pornirea.

Regulile, identice în ambele:

| Stare | Redirect |
|---|---|
| `status = 'loading'` | nimic (splash — starea nu e încă cunoscută) |
| `status = 'unauthenticated'` | → `(auth)/welcome` |
| autentificat, `profile_completed = false` | → `(onboarding)` |
| autentificat, profil complet | → `(tabs)/ankete` (și nu rămâne blocat în `(auth)` / `(onboarding)`) |

**🚫 Fără AgeGuard.** Aplicația e **18+ ONLY** (`MIN_AGE = 18` în `src/utils/validation.ts`). Segmentul 16–17 a fost eliminat complet din produs — cerință App Store / Google Play pentru dating. Nu există și nu va exista o separare 16–17 / 18+ la nivel de UI.

**🔜 Planificat:** `VerificationGuard` (verificare facială — TZ 2.2, momentan stub), `PremiumGuard` (gating pe abonament — TZ 9; paywall-ul există, dar fără IAP nativ).

Starea vine din `authStore` (Zustand) + `@/services/api` (token store: access în memorie, refresh în SecureStore).
