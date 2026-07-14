# FLIRT — Arhitectură Frontend (React Native + Expo)

> Documentația arhitecturii aplicației mobile FLIRT — „No Regrets".
> Text explicativ în română, cod și denumiri în engleză.
>
> **Acest document descrie codul REAL din `mobile/`, nu un blueprint.** Fiecare rând din tabelul de stack există în `mobile/package.json`. Ce nu e implementat stă separat, în [secțiunea 6](#6--ce-nu-există-încă-amânat-conștient), cu consecințele pentru App Store — ca nimeni să nu descopere la submit că lipsește ceva.

Fișiere înrudite:
- [`navigation.md`](./navigation.md) — structura de navigație (tab bar + stack-uri).
- [`screens.md`](./screens.md) — toate ecranele mapate pe TZ.
- [`styling.md`](./styling.md) — principiul „stiluri separate de cod" + theming.

---

## 1. Stack tehnologic (real)

Sursa de adevăr: `mobile/package.json`. Dacă o bibliotecă nu e în tabelul de mai jos, **nu e în proiect**.

| Domeniu | Alegere reală | De ce |
|---|---|---|
| Runtime / build | **Expo SDK 54** (managed), React Native **0.81.5**, React **19.1**, New Architecture activă | Un singur codebase iOS + Android, EAS Build/Submit, module native gata făcute. `newArchEnabled: true` în `app.json`. |
| Limbaj | **TypeScript strict** (`tsconfig.json` → `"strict": true`) | Contractele de date (anketă, feed, chat, evenimente) sunt complexe; tipurile prind erorile înainte de runtime. Mapările snake_case (backend) ↔ camelCase (UI) sunt explicite în fiecare `*Api.ts`. |
| Navigație | **expo-router ~6** (file-based, peste React Navigation) | Arborele din `mobile/app/` **este** graful de navigație. Deep linking gratuit, tab-uri + stack-uri imbricate, rute tipizate. |
| State server | **@tanstack/react-query v5** | Cache, retry, invalidare, mutații. **Tot ce vine de la API trece pe aici** — inclusiv „realtime"-ul din chat, care e polling (vezi §5). |
| State client | **zustand v4** | Store-uri mici, fără boilerplate: `authStore` (sesiune) și `anketaStore` (draft-ul wizardului între pași). Atât — restul e state server sau state local de componentă. |
| Networking | **axios** — client unic în `src/services/api.ts` | O singură instanță cu `baseURL`, timeout 15s, interceptor de Bearer token și refresh automat la 401 (vezi §4). Niciun `fetch` răzleț prin ecrane. |
| Tokenuri | **expo-secure-store** | Refresh token-ul stă în Keychain (iOS) / Keystore (Android), cheia `flirt.refresh_token`. Access token-ul stă **doar în memorie** — vezi §4 pentru motiv. |
| Gesturi + animații | **PanResponder + Animated** (built-in React Native) | Swipe-ul din feed (`app/(tabs)/ankete.tsx`) e făcut cu API-urile din React Native. **Fără** `react-native-gesture-handler`, **fără** `reanimated` — un deck cu un singur card animat nu justifică încă două dependențe native în plus. Dacă ajungem la un deck stivuit cu fizică reală, reanimated devine justificat. |
| Formulare + validare | **funcții proprii**: `src/utils/validation.ts`, `src/features/anketa/validation.ts`, `src/features/auth/validation.ts`, `src/features/photos/validation.ts` | Fără `react-hook-form`, fără `zod`. Validatoarele sunt funcții pure care întorc `string | null` (mesajul de eroare în română) — trivial de testat și **simetrice cu regulile din backend** (lungimi, vârstă minimă, tipuri MIME, număr de poze). |
| Hărți | **react-native-webview** + **Leaflet** + tiles **OpenStreetMap** | `src/features/events/EventMap.tsx` randează o hartă reală într-un WebView. **Gratuit, fără cheie API și fără cont** — merge în Expo Go, identic pe ambele platforme. Alternativa (`react-native-maps`) cere cheie Google Maps și cont de billing pentru un singur ecran; nu merită. Atribuția OSM (ODbL) e obligatorie și e în cod — nu o scoate. |
| Poze de profil | **expo-image-picker** + **expo-image-manipulator** + **expo-file-system** | Alegerea din galerie, apoi redimensionare (max 1920px) și recompresie JPEG **înainte** de upload (`src/features/photos/photoPicker.ts`). O poză de pe un telefon modern are 5–12 MB și ar fi respinsă de backend cu 413 — o comprimăm client-side, cu recompresie în trepte până intră sub limita de 8 MB. |
| Fonturi | **@expo-google-fonts/manrope** + **expo-font** | Manrope Regular/Medium/Bold, încărcate în `app/_layout.tsx`. Aplicația nu randează nimic până nu sunt gata (`if (!fontsLoaded) return null`) — evită flash-ul de font de sistem. |
| Config runtime | **expo-constants** + `EXPO_PUBLIC_API_URL` | `src/config.ts` — vezi §7. Niciun URL hardcodat în ecrane. |
| Shell UI | **react-native-safe-area-context**, **react-native-screens**, **expo-status-bar**, **expo-linking** | Standardul Expo pentru safe areas, navigare nativă performantă, status bar și deep links. |
| Testare | **Jest** + **jest-expo** + **@testing-library/react-native** | **340 teste / 57 suite.** Rulare: `npm test`. Typecheck: `npm run typecheck`. Fără Detox (E2E) deocamdată. |

### De ce Expo și nu bare React Native
Un singur codebase, EAS Build/Submit, și module native gata făcute pentru exact ce ne trebuie (secure store, image picker, fonturi). Pentru pașii care vor cere cod nativ (IAP, liveness-check) folosim **development build** / config plugins — nu pierdem nimic din managed workflow.

---

## 2. Principii de arhitectură

Sunt puține și sunt respectate peste tot în cod. Dacă scrii cod nou, respectă-le.

1. **Rutele sunt subțiri.** Fișierele din `app/` compun ecrane; logica de business (apeluri API, mapări, validare, tipuri) stă în `src/features/*`. O rută nu conține niciodată o mapare snake_case → camelCase.
2. **State server ≠ state client.** Tot ce vine de la API trece prin **React Query**. **Zustand** ține doar ce nu are ce căuta pe server: sesiunea și draft-ul anketei între pași. Nu duplica date de server într-un store Zustand.
3. **Feature-based, nu type-based.** Codul e grupat pe funcționalitate de business (`feed`, `chat`, `events`, `photos`), nu pe tip tehnic. Fiecare feature își ține API-ul, tipurile, validarea și componentele lui de domeniu.
4. **Stiluri separate de cod.** Nicio culoare/spacing hardcodat în componente — totul din `@theme`. Vezi [`styling.md`](./styling.md).
5. **Un singur punct de acces la rețea.** Tot traficul trece prin instanța axios din `src/services/api.ts`. Așa avem un singur loc pentru token, refresh și timeout — și un singur loc de mock-uit în teste.
6. **Zero hardcodare.** Opțiunile de anketă (genuri, limbi, interese, statusuri) vin din `GET /profiles/reference`. Limitele de poze, URL-ul API, config-ul hărții și link-urile legale vin din config (§7). Un ecran nu „știe" niciodată o valoare de business.
7. **Simetrie cu backend-ul.** Validarea client-side repetă regulile serverului (vârstă ≥18, min 3 / max 9 poze, max 8 MB, tipuri MIME). Clientul dă feedback rapid; **serverul rămâne autoritatea** — validarea din UI e pentru UX, nu pentru securitate.

---

## 3. Structura reală de foldere

```
mobile/
├── app.json                    # config Expo: plugins, permisiuni, privacy manifest, extra
├── eas.json                    # profile EAS (development / preview / production) + EXPO_PUBLIC_API_URL
├── tsconfig.json               # strict + aliasuri
├── babel.config.js             # module-resolver (aceleași aliasuri ca tsconfig)
├── jest.setup.js
│
├── app/                        # === RUTE (expo-router) — la RĂDĂCINĂ, nu în src/ ===
│   ├── _layout.tsx             # providers: SafeArea, QueryClient, ThemeProvider + AuthGuard reactiv
│   ├── index.tsx               # splash / redirect după sesiune
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   ├── welcome.tsx         # Google / Apple / telefon / email
│   │   ├── login.tsx
│   │   ├── register.tsx
│   │   └── phone.tsx           # OTP prin SMS
│   ├── (onboarding)/
│   │   ├── _layout.tsx
│   │   └── index.tsx           # wizard anketă multi-pas, ÎNTR-UN SINGUR ECRAN
│   ├── (tabs)/                 # === TAB BAR — 3 taburi ===
│   │   ├── _layout.tsx
│   │   ├── ankete.tsx          # feed de swipe (default) + StoriesBar
│   │   ├── mesaje.tsx          # lista de dialoguri
│   │   └── setari.tsx          # hub-ul de navigare (vezi mai jos)
│   ├── chat/[id].tsx
│   ├── profile/edit.tsx
│   ├── events/index.tsx · events/[id].tsx
│   ├── stories/new.tsx · stories/[userId].tsx
│   ├── favorites.tsx · blocklist.tsx · ticket.tsx · passport.tsx
│   ├── humor.tsx               # modal
│   ├── paywall.tsx             # modal
│   └── verify-face.tsx         # modal
│
├── theme/                      # === STILURI (la rădăcină, NU în src/) ===
│   ├── colors.ts               # tokens dark + light
│   ├── typography.ts           # Manrope
│   ├── ThemeProvider.tsx       # context + useTheme()
│   └── index.ts
│
├── src/
│   ├── config.ts               # API URL, hartă, legal, limite de poze
│   │
│   ├── services/               # === ACCES LA EXTERIOR ===
│   │   ├── api.ts              # instanța axios + interceptori (Bearer, refresh la 401)
│   │   └── tokenStore.ts       # access în memorie, refresh în SecureStore
│   │
│   ├── store/
│   │   └── authStore.ts        # Zustand: sesiune, login/register/OTP/social, hydrate, logout
│   │
│   ├── features/               # === LOGICA DE BUSINESS, pe feature ===
│   │   ├── anketa/             # anketaApi, anketaStore (draft wizard), validation, types
│   │   ├── auth/               # socialAuth (⚠ stub), validation
│   │   ├── chat/               # chatApi, ChatListItem, MessageBubble, types
│   │   ├── events/             # eventsApi, EventCard, EventMap (WebView + Leaflet), types
│   │   ├── feed/               # feedApi, ProfileCard, CompatBadge, MatchModal,
│   │   │                       #   SendFirstMessageSheet, compat.ts
│   │   ├── humor/              # humorApi, types
│   │   ├── moderation/         # reportApi, ReportModal
│   │   ├── photos/             # photoPicker, usePhotoPicker, PhotoGrid, photosApi,
│   │   │                       #   reorder, validation, types
│   │   ├── profile/            # profileApi
│   │   ├── push/               # pushService (⚠ token placeholder)
│   │   ├── settings/           # settingsApi
│   │   ├── social/             # socialApi, useBlockUser
│   │   ├── stories/            # storiesApi, StoriesBar, types
│   │   ├── subscription/       # subscriptionApi (⚠ fără IAP nativ), types
│   │   └── verification/       # faceApi (⚠ stub, fără cameră)
│   │
│   ├── components/ui/          # === UI PUR, fără logică de domeniu ===
│   │   ├── Button.tsx · Input.tsx · ProgressDots.tsx · ScreenContainer.tsx
│   │   └── index.ts
│   │
│   └── utils/
│       └── validation.ts       # validatoare transversale (MIN_AGE = 18, email, parolă...)
│
└── assets/                     # icon, splash, adaptive-icon, favicon
```

> **Notă:** `src/hooks/` și `src/types/` există ca foldere, dar sunt **goale**. Hook-urile trăiesc în feature-ul lor (`usePhotoPicker`, `useBlockUser`), iar tipurile în `features/*/types.ts`. Nu forța conținut în ele doar ca să nu fie goale.

### Aliasuri de import

Configurate identic în `tsconfig.json` (pentru typecheck) **și** `babel.config.js` (pentru runtime). Sunt doar **două** — dacă adaugi al treilea, adaugă-l în ambele fișiere, altfel typecheck-ul trece și aplicația crapă la runtime.

```
@/*        → src/*        # import { api } from '@/services/api'
@theme/*   → theme/*      # import { useTheme } from '@theme/index'
```

### Regula de dependențe între straturi

```
app/  →  features/  →  services/ + store/ + config + utils
                    →  components/ui/ + theme/
```
- `app/` (rute) importă din `features/`; **`features/` nu importă niciodată din `app/`**.
- `components/ui/` nu știe nimic despre domeniu (nu importă din `features/`).
- `theme/`, `utils/`, `config` sunt frunze — nu depind de nimic de business.

### Setări = singurul hub de navigare

**Detaliu de arhitectură ușor de ratat:** tab-ul **Setări** (`app/(tabs)/setari.tsx`) e **singura cale** către majoritatea ecranelor. Din el se deschid:

`profile/edit` · `verify-face` · `paywall` · `humor` · `favorites` · `events` · `passport` · `ticket` · `blocklist`

Cele 3 taburi acoperă doar feed, mesaje și setări. **Fără hub-ul din Setări, nouă ecrane implementate sunt inaccesibile din UI.** Dacă ștergi sau reorganizezi lista de linkuri de acolo, verifică întâi cine mai duce la ecranul respectiv — cel mai probabil nimeni.

---

## 4. Autentificare și tokenuri (real)

`src/services/tokenStore.ts` + interceptorii din `src/services/api.ts`.

| Token | Unde stă | De ce acolo |
|---|---|---|
| **Access** | **doar în memorie** (variabilă de modul) | Are viață scurtă. Nescris pe disc = nu poate fi extras dintr-un backup al telefonului sau de pe un device rootat. Se pierde la kill — și e în regulă: îl reobținem din refresh la pornire. |
| **Refresh** | **expo-secure-store**, cheia `flirt.refresh_token` | Keychain (iOS) / Keystore (Android) — criptat de sistemul de operare. E singurul lucru persistat. |

**Fluxul de refresh (single-flight):**
1. Interceptorul de request atașează `Authorization: Bearer <access>` dacă există token.
2. La un răspuns **401** pe o rută care **nu** e `/auth/*`, interceptorul de response marchează cererea cu `_retry`, apelează **o singură dată** `POST /auth/refresh` și **reîncearcă cererea o dată**.
3. Promisiunea de refresh e memorată (`refreshing`) — dacă zece cereri primesc 401 simultan, se face **un singur** apel de refresh, nu zece. Fără asta, un ecran cu mai multe query-uri paralele ar bombarda serverul la fiecare expirare de token.
4. Dacă refresh-ul eșuează → `tokenStore.clear()` → utilizatorul e deconectat.

**La pornire** (`authStore.hydrate()`, apelat din `app/_layout.tsx`): dacă există refresh token în SecureStore, îl schimbăm pe o pereche nouă și aducem `/auth/me`. Dacă nu, `status = 'unauthenticated'`. Guard-ul reactiv din `_layout.tsx` (`AuthGuard`) reacționează la schimbările din store și redirecționează: fără sesiune → `(auth)/welcome`; sesiune dar `profile_completed = false` → `(onboarding)`; totul OK → `(tabs)/ankete`.

---

## 5. Fluxul de date (real)

```
Ecran (app/*)
   │
   ├──► React Query  ──► src/services/api.ts (axios)  ──► Backend REST
   │      • citiri: useQuery (feed, chats, messages, events, plans, settings...)
   │      • scrieri: useMutation (swipe, send, react, purchase, going, checkin...)
   │      • polling: refetchInterval (chat)
   │
   ├──► Zustand
   │      • authStore   — sesiune, user, profile_completed
   │      • anketaStore — draft-ul wizardului între pași
   │
   └──► theme/ (useTheme) — culori, tipografie
```

**Chatul e polling, nu WebSocket.** Nu există `socket.io` și nicio conexiune WebSocket în proiect. React Query reface cererea la interval:

| Ecran | Interval | De ce |
|---|---|---|
| `app/chat/[id].tsx` | **3 s** | Conversație deschisă — utilizatorul se uită la ecran, latența trebuie să fie mică. |
| `app/(tabs)/mesaje.tsx` | **5 s** | Lista de dialoguri — un badge de necitit poate întârzia câteva secunde fără să deranjeze. |

**De ce polling și nu WebSocket:** e o decizie conștientă de MVP. Polling-ul e câteva rânduri de config peste infrastructura pe care o avem deja (React Query + axios + JWT), nu cere nimic nou pe backend, și supraviețuiește reconectărilor mobile fără cod special. Prețul: latență de câteva secunde, fără „typing…", fără status online, și trafic constant care consumă baterie. La volum real, un WebSocket va fi justificat — dar înlocuirea atinge **doar** hook-urile de chat, nu ecranele, pentru că datele intră tot prin cache-ul React Query.

**Mapare snake_case ↔ camelCase:** fiecare `*Api.ts` declară forma brută a răspunsului (`interface XResponse`, snake_case) și o funcție `mapX()` care o convertește în tipul de UI (camelCase). Backend-ul își poate redenumi câmpurile — se schimbă un singur fișier, nu douăzeci de componente.

---

## 6. ❌ Ce NU există încă (amânat conștient)

Toate au ecran/cod, dar **nu fac lucrul real**. Sunt aici ca să nu fie descoperite la submit.

| Ce | Starea reală în cod | Consecința |
|---|---|---|
| **IAP nativ** (in-app purchase) | ❌ Nu există `expo-in-app-purchases` / RevenueCat. `app/paywall.tsx` afișează planurile din `GET /subscriptions/plans` și „cumpără" cu `POST /subscriptions/purchase`, care **activează abonamentul direct pe backend, fără plată reală**. | 🔴 **Blocant absolut la submit.** App Store **Guideline 3.1.1**: conținutul digital deblocat în aplicație **trebuie** vândut prin In-App Purchase. Un paywall care ocolește IAP nu e doar respins — e motivul clasic de respingere. **Fără asta nu se poate trimite aplicația.** Același lucru pe Google Play (Play Billing). |
| **Cameră / verificare prin selfie** | ❌ `app/verify-face.tsx` există și arată un cadru de captură **stilizat cu emoji** — nu deschide camera. `faceApi.verifyFace()` face `POST /profiles/verify-face` cu un body `{ source: 'selfie' }` — **nicio imagine nu e capturată sau trimisă**. `expo-camera` nu e instalat. | 🟡 Nu blochează submit-ul, dar badge-ul de „verificat" e **fals** — îl primește oricine apasă butonul. Într-o aplicație de dating, o insignă de încredere fără nimic în spate e un risc de siguranță (și de reputație), nu doar o funcție lipsă. |
| **Login social nativ** | ❌ `src/features/auth/socialAuth.ts` întoarce token-uri **stub** hardcodate (`stub:google@example.com`, `stub:apple@example.com`). Butoanele „Continuă cu Google/Apple" din `(auth)/welcome.tsx` există și sunt funcționale **doar** cu backendul în modul stub. Nu există `expo-auth-session` / `expo-apple-authentication`. | 🔴 **Guideline 4.8 (Sign in with Apple):** dacă oferi login cu Google (sau orice login social terț), Apple cere **obligatoriu** și **Sign in with Apple**. Deci ori implementezi ambele nativ, ori **scoți butoanele sociale** înainte de submit. A le lăsa stub = respingere sigură (butonul „nu face nimic" e și Guideline 2.1). |
| **URL-uri legale** | ⚠️ `src/config.ts` → `legal` are fallback-uri către **`https://flirt.app/...`** — **un domeniu care nu e al nostru**. `app.json` → `extra` **nu** le suprascrie momentan, deci build-ul actual folosește exact aceste placeholder-e. | 🔴 **Obligatorii la submit.** Guideline 3.1.2 (link ToS/EULA + Privacy pe ecranul de abonament), 5.1.1 (politica de confidențialitate accesibilă din app), 1.2 (contact de suport). Pune URL-uri **live, publice, fără login** în `app.json` → `extra.termsUrl` / `privacyUrl` / `supportUrl` și declară-le identic în App Store Connect. |
| **Push notifications** | ❌ `expo-notifications` **nu e instalat**. `src/features/push/pushService.ts` trimite la backend un token placeholder (`expo-dev-token-ios`). Înregistrarea nu aruncă niciodată eroare — push-ul e opțional și nu blochează pornirea. | 🟢 Nu blochează submit-ul. Dar permisiunea `POST_NOTIFICATIONS` e deja cerută în `app.json` — cerem o permisiune pe care **nu o folosim**, ceea ce e un semnal prost la review. |
| **Upload media la Stories** | ❌ `app/stories/new.tsx` acceptă doar un **URL** de media (câmp text). Poze de profil se pot încărca real (expo-image-picker), story-uri nu. | 🟢 Funcțional, dar UX slab — niciun utilizator real nu are un URL de imagine la îndemână. |
| **Reanimated / gesture-handler** | ❌ Neinstalate. Swipe-ul merge pe `PanResponder` + `Animated`. | 🟢 Fără consecințe. Decizie deliberată (vezi §1). |
| **Localizare (i18n)** | ❌ Nu există `i18next`. Textele sunt **în română, direct în componente**. | 🟢 Fără consecințe pentru MVP. Extragerea în fișiere de traduceri devine necesară doar când adăugăm a doua limbă — cu cât mai târziu, cu atât mai multe string-uri de extras. |
| **`events/map`** (Live Events Map) | ❌ Ruta nu există. Harta reală (WebView + Leaflet + OSM) e implementată, dar **doar în detaliul unui eveniment** (`events/[id]`). | 🟢 Funcție de produs lipsă, nu blocant tehnic — infrastructura de hartă e deja acolo. |
| **E2E (Detox)** | ❌ Neinstalat. Doar Jest (unit + component). | 🟢 Fără consecințe imediate. |

### Ordinea de atac înainte de submit

1. **IAP nativ** — fără el nu se poate trimite. Nimic altceva nu contează dacă asta lipsește.
2. **Login social**: implementează Google **+ Sign in with Apple**, sau scoate ambele butoane. Nu există cale de mijloc.
3. **URL-uri legale reale** în `app.json` → `extra`.
4. **Verificarea prin selfie**: implementeaz-o cu cameră reală, sau **scoate badge-ul de „verificat"** — o insignă de încredere falsă e mai rea decât absența ei.
5. Push real (sau scoate permisiunea `POST_NOTIFICATIONS` din `app.json`).

---

## 7. Config (real) — `src/config.ts`

Niciun URL și nicio limită nu sunt hardcodate în ecrane. Totul trece prin `config`.

**API URL** — ordinea de rezoluție:
```
process.env.EXPO_PUBLIC_API_URL   (din eas.json, inline-uit în bundle la build)
   → app.json → extra.apiUrl      (override local / teste)
   → http://localhost:8000/api/v1 (DOAR în __DEV__)
```

Build-ul de producție **crapă intenționat la pornire** dacă `EXPO_PUBLIC_API_URL` lipsește sau **nu e HTTPS**:
- Un build de release fără URL ar cădea pe `localhost` — care **nu există** pe un telefon fizic. Rezultat: eroare de rețea pe fiecare ecran.
- HTTP cleartext e blocat de App Transport Security pe iOS.

În ambele cazuri, recenzentul Apple ar vedea o aplicație complet moartă (respingere sigură pe Guideline 2.1). **Mai bine o excepție zgomotoasă în testarea internă decât o respingere tăcută la review.**

Profilele din `eas.json`:

| Profil | `EXPO_PUBLIC_API_URL` |
|---|---|
| `development` | `http://192.168.1.10:8000/api/v1` (LAN — schimbă IP-ul cu al tău) |
| `preview` | `https://staging-api.flrt.md/api/v1` |
| `production` | `https://api.flrt.md/api/v1` |

**Restul config-ului** (`app.json` → `expo.extra`, cu fallback-uri în cod):

| Grup | Chei | Note |
|---|---|---|
| Hartă | `mapTileUrl`, `mapAttribution`, `mapZoom`, `mapLeafletCssUrl`, `mapLeafletJsUrl` | **Fără cheie API.** Tiles OSM + Leaflet din CDN (unpkg), încărcate doar în WebView. Atribuția e obligatorie prin licența ODbL. Momentan **nu sunt suprascrise** în `app.json` — se folosesc valorile implicite din cod. |
| Poze | `photoMinCount` (3), `photoMaxCount` (9), `photoMaxUploadBytes` (8 MB), `photoAllowedTypes`, `photoMaxDimension` (1920), `photoCompressQuality` (0.8), `photoMinCompressQuality` (0.4) | **Simetrice cu backend-ul** (`app/core/config.py`). Dacă backendul își schimbă limitele, se suprascriu din `app.json` — fără a atinge codul ecranelor. |
| Legal | `termsUrl`, `privacyUrl`, `supportUrl` | ⚠️ **Placeholder-e** (`https://flirt.app/...`). Vezi §6. |

---

## 8. 18+ ONLY

`src/utils/validation.ts` → **`MIN_AGE = 18`**. Data nașterii e validată la onboarding și la editarea profilului.

Segmentul **16–17 a fost eliminat complet** din produs. Motivul e simplu și nenegociabil: App Store și Google Play **nu acceptă minori într-o aplicație de dating**. Orice guard, filtru sau separare pe vârstă sub 18 e **obsolet** — dacă îl întâlnești în cod sau în documentație, e o rămășiță și trebuie scos.

---

## 9. Comenzi

```bash
cd mobile
npm test           # 340 teste, 57 suite (Jest + jest-expo)
npm run typecheck  # tsc --noEmit (strict)
npm run lint       # eslint
npm start          # expo start
```
