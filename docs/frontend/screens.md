# FLIRT — Ecrane (mapate pe rutele reale)

> Vezi și: [`README.md`](./README.md) · [`navigation.md`](./navigation.md) · [`styling.md`](./styling.md) · [`PROGRESS.md`](../../PROGRESS.md)
>
> Documentul reflectă ecranele **reale** din `mobile/app/**`. Implementările trăiesc în `src/features/*`, iar rutele din `app/` doar le compun. Ecranele din blueprint încă neimplementate sunt marcate **🔜 Planificat**.

Legendă state: **[Q]** = React Query (state server) · **[Z]** = Zustand (state client) · **[F]** = form local.

---

# ✅ Implementat (MVP)

## 0. Splash / redirect

- **Rută:** `app/index.tsx`
- **Scop:** hidratarea sesiunii, apoi redirect: fără sesiune → `(auth)/welcome`; anketă incompletă → `(onboarding)`; altfel → `(tabs)/ankete`.
- **State:** [Z] `authStore` · [Q] validare token.

---

## 1. Auth

### 1.1 Welcome — `app/(auth)/welcome.tsx`
- **Scop:** ecran de start: **Continuă cu Google** / **Continuă cu Apple** / **telefon** / **Login** / **Register**. **Feature:** `auth`.
- **TZ:** 2.1.
- **⚠️ Login social = stub.** `socialAuth.ts` întoarce token-uri hardcodate (`stub:google@example.com`), acceptate doar de backendul în modul stub. Nu există `expo-auth-session` / `expo-apple-authentication`. **Guideline 4.8:** dacă oferi Google, Apple cere obligatoriu și Sign in with Apple — deci ori le implementezi nativ pe ambele, ori scoți butoanele înainte de submit.

### 1.2 Login — `app/(auth)/login.tsx`
- **Scop:** formular email + parolă → `POST /auth/login`. **Feature:** `auth`.
- **State:** [F] credențiale · [Q] mutație login · [Z] `authStore`.

### 1.3 Register — `app/(auth)/register.tsx`
- **Scop:** înregistrare email + parolă (min 8) → `POST /auth/register`. **Feature:** `auth`.
- **State:** [F] credențiale · [Q] mutație register · [Z] `authStore`.

### 1.4 Telefon / OTP — `app/(auth)/phone.tsx`
- **Scop:** număr de telefon → `POST /auth/phone/request`, apoi cod OTP → `POST /auth/phone/verify`. **Feature:** `auth`.
- **State:** [F] telefon + cod · [Z] `authStore` (`requestPhoneOtp`, `verifyPhoneOtp`).

---

## 2. Onboarding — wizard anketă

- **Rută:** `app/(onboarding)/index.tsx` · **Feature:** `anketa` (+ `photos`)
- **Scop:** wizard cu **5 pași într-un singur ecran** (`ANKETA_STEPS = 5`); opțiunile (genuri, statusuri, limbi, interese) vin din `GET /profiles/reference` (**fără hardcodare**), salvare finală cu `PUT /profiles/me`.
- **Câmpuri (TZ 2.4–2.6):** nume, dată naștere (**≥ 18 ani**), gen, înălțime, oraș, stradă/naționalitate (opțional), limbi, „despre mine" (≤500), interese (multiselect), statusuri de cunoștință.
- **✅ Pasul 4 (ultimul) = poze** (`PHOTOS_STEP = 4`): alegere din galerie cu **expo-image-picker**, redimensionare + recompresie client-side (**expo-image-manipulator**), reordonare (`PhotoGrid`), upload cu `POST /profiles/photos`. Limitele (min 3 / max 9, ≤8 MB, tipuri MIME) vin din `config.photos` și sunt simetrice cu backendul. Anketa se salvează **înainte** de upload — `/profiles/photos` întoarce 404 pentru un profil inexistent.
- **Componente cheie:** `ProgressDots`, `Input`, `PhotoGrid`, `usePhotoPicker`.
- **State:** [Z] `anketaStore` (draft între pași) · [Q] `useSaveProfile`.
- **🔜 Planificat în cadrul wizardului:** testul de umor (există ca ecran separat, `app/humor.tsx`, deschis din Setări — nu e integrat în wizard).

---

## 3. Tab 1 — Ankete (feed de swipe)

- **Rută:** `app/(tabs)/ankete.tsx` · **Feature:** `feed` (+ `stories`)
- **Scop:** feed-ul de candidate din `GET /feed`, cu acțiuni like/dislike prin **butoane + gesturi de swipe** și detectare match.
- **Componente cheie:**
  - `StoriesBar` (sus) — poveștile active proprii + ale match-urilor → deschide `stories/[userId]`.
  - `ProfileCard` — foto + nume/vârstă/oraș + `distance_km` real + „despre" + top interese; buton ⚠ raportare (`ReportModal`).
  - `CompatBadge` — badge cu % (verde >80 / galben 50–80 / gri <50).
  - `ActionBar` — butoane **like / dislike** + **undo** (`POST /feed/undo`) → `POST /feed/swipe`.
  - **Gesturi de swipe** — `PanResponder` + `Animated` (built-in, fără Reanimated): drag stânga/dreapta = dislike/like.
  - `SendFirstMessageSheet` — bottom sheet la like: mesaj deferred (TZ 4.7), livrat la match reciproc.
  - `MatchModal` — overlay „Connect!" la match reciproc.
- **TZ:** 4.1 (card), 4.2 (Compatibility + culori), 4.4 (like/dislike + undo), 4.7 (mesaj la like).
- **State:** [Q] `useFeed`, `useSwipe`, `useUndo` · [Z] index curent.
- **🔜 Planificat:** galerie multi-foto tip Stories, `FullProfileSheet` (swipe-up), favorite din deck, `EventBadge`, limită 10 + reclamă 15s.

---

## 4. Tab 2 — Mesaje

### 4.1 Lista de dialoguri — `app/(tabs)/mesaje.tsx`
- **Scop:** conversațiile din match-uri (`GET /chats`): nume, ultim mesaj, badge necitite; **polling la 5 s** (React Query `refetchInterval`). **Feature:** `chat`.
- **TZ:** 5.1.
- **State:** [Q] `useChats` (polling).

### 4.2 Ecran de conversație — `app/chat/[id].tsx`
- **Scop:** conversația 1:1: bule de mesaje, input + trimite (`POST /chats/{id}/messages`), mark-read (`POST /chats/{id}/read`), hint discret când un contact e mascat (`was_masked`), **reacții pe mesaje** (long-press → picker emoji, `POST /chats/{id}/messages/{id}/react`), **Compatibility Score în header**, **raportare** (`ReportModal` → `POST /reports/`). **Feature:** `chat` (+ `moderation`).
- **Componente cheie:** `MessageBubble` (cu reacție), `MaskedContactHint`, `Composer`, `ReportModal`.
- **TZ:** 5.2 (elemente de bază + reacții), 5.5 (mascare contacte + raportare).
- **State:** [Q] `useMessages` (**polling la 3 s**) · [Q] `useSendMessage`, `useReact`.
- **🔜 Planificat:** status online în header, `AiHintBanner` (5.3), `EventSuggestionBanner`, Chemistry Score, **realtime WebSocket** — momentan e polling (nu există socket.io / WebSocket în proiect; vezi [`README.md` §5](./README.md#5-fluxul-de-date-real)).

---

## 5. Tab 3 — Setări / Profil

### 5.1 Hub setări — `app/(tabs)/setari.tsx`
- **Scop:** hub-ul de setări (`GET/PUT /settings`): temă (light/dark/system), rază de căutare, notificări, ascundere profil (`profile_hidden`), logout + **linkurile spre restul aplicației**. **Feature:** `settings`.
- **TZ:** 6 (structura tabului) + 6.3.
- **State:** [Z] `themeStore`, `authStore` · [Q] `useSettings`.
- **⚠️ Singurul hub de navigare.** Cele 9 linkuri de aici (`profile/edit`, `verify-face`, `paywall`, `humor`, `favorites`, `events`, `passport`, `ticket`, `blocklist`) sunt **singura cale** către acele ecrane. Taburile acoperă doar feed / mesaje / setări. Scoate linkurile → ecranele rămân implementate, dar inaccesibile.

### 5.2 Editare anketă — `app/profile/edit.tsx`
- **Scop:** editarea completă a anketei (aceleași câmpuri ca onboarding) → `PUT /profiles/me`. **Feature:** `profile`.
- **State:** [F] formular · [Q] `useUpdateProfile`.

### 5.3 Favorites — `app/favorites.tsx`
- **Scop:** lista de favorite (`GET /social/favorites`), cu ★. **Feature:** `social`.
- **State:** [Q] `useFavorites`.

### 5.4 Ticket — `app/ticket.tsx`
- **Scop:** biletul Flirt Party (`GET /ticket`): cod + QR placeholder. **Feature:** `settings`.
- **TZ:** 6.2.
- **State:** [Q] `useTicket`.

### 5.5 Blocklist — `app/blocklist.tsx`
- **Scop:** lista de useri blocați (`GET /social/blocks`) + deblocare (`DELETE`). **Feature:** `social`.
- **TZ:** 6.3.
- **State:** [Q] `useBlocks`.

### 5.6 Test de umor — `app/humor.tsx`
- **Scop:** testul de umor (`GET /humor/quiz`): carduri cu glume, marcaj amuzant / nu, trimitere (`POST /humor/submit`) → scrie `Profile.humor_vector` (intră cu 20% în Compatibility Score). Link din hub-ul Setări. **Feature:** `humor`.
- **TZ:** 2.7.
- **State:** [Q] `useHumorQuiz`, `useSubmitHumor`.

### 5.7 Paywall — `app/paywall.tsx` (modal)
- **Scop:** planurile de abonament (`GET /subscriptions/plans`), abonamentul curent (`GET /subscriptions/me`), „cumpărare" (`POST /subscriptions/purchase`). Link din hub-ul Setări. **Feature:** `subscription`.
- **TZ:** 9.
- **State:** [Q] `fetchPlans`, `fetchMySubscription`, `purchase`, `fetchEntitlements`.
- **🔴 ⚠️ FĂRĂ IAP NATIV — blocant la submit.** Nu există `expo-in-app-purchases` / RevenueCat. `POST /subscriptions/purchase` **activează abonamentul direct pe backend, fără plată reală**. App Store **Guideline 3.1.1** cere ca orice conținut digital deblocat în app să fie vândut prin In-App Purchase. **Aplicația nu poate fi trimisă la review în starea asta.** Idem Google Play Billing.

### 5.8 Verificare prin selfie — `app/verify-face.tsx` (modal)
- **Scop:** verificarea că profilul aparține unei persoane reale → `POST /profiles/verify-face`. Link din hub-ul Setări. **Feature:** `verification`.
- **TZ:** 2.2.
- **State:** [Q] `verifyFace`.
- **⚠️ Stub, fără cameră.** `expo-camera` nu e instalat; „cadrul de captură" e un dreptunghi stilizat cu emoji. `faceApi.verifyFace()` trimite un body `{ source: 'selfie' }` — **nicio imagine nu e capturată sau trimisă**. Consecință: badge-ul de „verificat" îl primește oricine apasă butonul. Într-o aplicație de dating, o insignă de încredere fără nimic în spate e un risc de siguranță, nu doar o funcție lipsă.

> Ștergerea contului (cu confirmare) → `POST /settings/account/delete` este declanșată din hub-ul Setări.

---

## 6. Events / Flirt Passport

### 6.1 Listă evenimente — `app/events/index.tsx`
- **Scop:** evenimentele viitoare (`GET /events`): cover, titlu, dată, oraș, număr participanți. **Feature:** `events`.
- **TZ:** 8.1–8.2.
- **State:** [Q] `useEvents`.

### 6.2 Detaliu eveniment — `app/events/[id].tsx`
- **Scop:** detaliul + **hartă reală** + marcaj „merg" (`POST /events/{id}/going`) + check-in QR (`POST /events/{id}/checkin`). **Feature:** `events`.
- **TZ:** 8.2, 8.4.
- **✅ Harta e reală:** `EventMap` = **react-native-webview + Leaflet + tiles OpenStreetMap**. **Gratuit, fără cheie API și fără cont** — merge în Expo Go, identic pe iOS și Android. **Nu** folosim `react-native-maps` (ar cere cheie Google Maps + billing). Fără coordonate valide (`hasValidCoords`), cade elegant pe o casetă cu orașul. Atribuția OSM (licența ODbL) e obligatorie — nu o scoate din cod.
- **State:** [Q] `useEvent`, `useGoing`, `useCheckin`.

### 6.3 Flirt Passport — `app/passport.tsx`
- **Scop:** grid cu ștampilele confirmate (`GET /events/passport`). **Feature:** `events`.
- **TZ:** 8.4.
- **State:** [Q] `usePassport`.

**🔜 Planificat:** ruta `events/map` — **Live Events Map** cu contor de useri pe marker (TZ 8.3). Infrastructura de hartă există deja (WebView + Leaflet + OSM, vezi 6.2) — lipsește doar ecranul agregat cu toate evenimentele.

---

## 7. Stories

### 7.1 Vizualizator — `app/stories/[userId].tsx`
- **Scop:** vizualizarea poveștilor unui user (`GET /stories`): bare de progres, tap next/prev, ștergerea propriilor povești (`DELETE /stories/{id}`). **Feature:** `stories`.
- **TZ:** secț. 11.
- **State:** [Q] `useStories`.

### 7.2 Creare poveste — `app/stories/new.tsx`
- **Scop:** publicarea unei povești prin URL media (`POST /stories`), expiră la 24h. **Feature:** `stories`.
- **State:** [F] URL + caption · [Q] `useCreateStory`.
- **🔜 Planificat:** upload real de media (momentan doar câmp URL).

---

# 🔜 Planificat (ecrane neimplementate)

| Ecran | Rută | Secțiune TZ |
|---|---|---|
| Event popup card (din deck) | overlay | 4.3, 8.2 |
| Live Events Map | `events/map` | 8.3 |
| Reclamă interstițială (15 s) | overlay în deck | 6.3 |

> **Toate celelalte ecrane sunt implementate.** `(auth)/phone` (OTP), butoanele sociale din `welcome`, `paywall`, `verify-face`, `humor`, upload-ul de poze, `SendFirstMessageSheet`, gesturile de swipe + undo — toate **✅ există** (vezi mai sus).
>
> **⚠️ „Ecran implementat" ≠ „funcție gata."** Trei ecrane sunt shell-uri peste funcționalitate care lipsește: **`paywall`** (fără IAP nativ — 🔴 blocant la submit, Guideline 3.1.1), **`verify-face`** (fără cameră) și butoanele sociale din **`welcome`** (token-uri stub — 🔴 Guideline 4.8). Detalii și ordinea de atac: [`README.md` §6](./README.md#6--ce-nu-există-încă-amânat-conștient).

---

## 8. Matrice ecran real → secțiune TZ

| Ecran (rută reală) | Secțiune TZ |
|---|---|
| `index` (splash) | 1.1 |
| `(auth)/welcome·login·register·phone` | 2.1 (email+parolă, OTP, social ⚠ stub) |
| `(onboarding)/index` | 2.4–2.6 (+ poze) |
| `(tabs)/ankete` | 4.1, 4.2, 4.4 |
| `(tabs)/mesaje` + `chat/[id]` | 5.1, 5.2, 5.5 |
| `(tabs)/setari` | 6, 6.3 |
| `humor` | 2.7 |
| `verify-face` | 2.2 (⚠ stub, fără cameră) |
| `paywall` | 9 (🔴 fără IAP nativ) |
| `profile/edit` | 6.1 |
| `favorites` | 6.1 |
| `ticket` | 6.2 |
| `blocklist` | 6.3 |
| `events/index·[id]` | 8.1, 8.2, 8.4 |
| `passport` | 8.4 |
| `stories/[userId]·new` | 11 |
