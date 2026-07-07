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
- **Scop:** ecran de start cu opțiunile **Login** / **Register**. **Feature:** `auth`.
- **TZ:** 2.1 (parțial — doar email + parolă).

### 1.2 Login — `app/(auth)/login.tsx`
- **Scop:** formular email + parolă → `POST /auth/login`. **Feature:** `auth`.
- **State:** [F] credențiale · [Q] mutație login · [Z] `authStore`.

### 1.3 Register — `app/(auth)/register.tsx`
- **Scop:** înregistrare email + parolă (min 8) → `POST /auth/register`. **Feature:** `auth`.
- **State:** [F] credențiale · [Q] mutație register · [Z] `authStore`.

---

## 2. Onboarding — wizard anketă

- **Rută:** `app/(onboarding)/index.tsx` · **Feature:** `anketa`
- **Scop:** wizard multi-pas care completează anketa; opțiunile (genuri, statusuri, limbi, interese) vin din `GET /profiles/reference` (**fără hardcodare**), salvare finală cu `PUT /profiles/me`.
- **Câmpuri (TZ 2.4–2.6):** nume, dată naștere, gen, înălțime, oraș, stradă/naționalitate (opțional), limbi, „despre mine" (≤500), interese (multiselect), statusuri de cunoștință.
- **Componente cheie:** `ProgressDots`, `Input`, opțiuni din backend.
- **State:** [F]/[Z] draft între pași · [Q] `useSaveProfile`.
- **🔜 Planificat în cadrul wizardului:** upload foto (3–9), testul de umor (5–7 carduri).

---

## 3. Tab 1 — Ankete (feed de swipe)

- **Rută:** `app/(tabs)/ankete.tsx` · **Feature:** `feed` (+ `stories`)
- **Scop:** feed-ul de candidate din `GET /feed`, cu acțiuni like/dislike prin **butoane** și detectare match.
- **Componente cheie:**
  - `StoriesBar` (sus) — poveștile active proprii + ale match-urilor → deschide `stories/[userId]`.
  - `ProfileCard` — foto + nume/vârstă/oraș + „despre" + top interese.
  - `CompatBadge` — badge cu % (verde >80 / galben 50–80 / gri <50).
  - `ActionBar` — butoane **like / dislike** → `POST /feed/swipe`.
  - `MatchModal` — overlay „Connect!" la match reciproc.
- **TZ:** 4.1 (card), 4.2 (Compatibility + culori), 4.4 (like/dislike).
- **State:** [Q] `useFeed`, `useSwipe` · [Z] index curent.
- **🔜 Planificat:** gesturi de swipe (Reanimated), galerie multi-foto tip Stories, `FullProfileSheet` (swipe-up), favorite din deck, `EventBadge`, limită 10 + reclamă 15s, `SendFirstMessageSheet` (mesaj la like — TZ 4.7).

---

## 4. Tab 2 — Mesaje

### 4.1 Lista de dialoguri — `app/(tabs)/mesaje.tsx`
- **Scop:** conversațiile din match-uri (`GET /chats`): nume, ultim mesaj, badge necitite; **polling** (React Query). **Feature:** `chat`.
- **TZ:** 5.1.
- **State:** [Q] `useChats` (polling).

### 4.2 Ecran de conversație — `app/chat/[id].tsx`
- **Scop:** conversația 1:1: bule de mesaje, input + trimite (`POST /chats/{id}/messages`), mark-read (`POST /chats/{id}/read`), hint discret când un contact e mascat (`was_masked`). **Feature:** `chat`.
- **Componente cheie:** `MessageBubble`, `MaskedContactHint`, `Composer`.
- **TZ:** 5.2 (elemente de bază), 5.5 (mascare contacte).
- **State:** [Q] `useMessages` (polling) · [Q] `useSendMessage`.
- **🔜 Planificat:** `ChatHeader` cu Compatibility Score/online, `AiHintBanner` (5.3), `EventSuggestionBanner`, reacții pe mesaje, raportare, realtime WebSocket (momentan polling).

---

## 5. Tab 3 — Setări / Profil

### 5.1 Hub setări — `app/(tabs)/setari.tsx`
- **Scop:** hub-ul de setări (`GET/PUT /settings`): temă (light/dark/system), rază de căutare, notificări, ascundere profil (`profile_hidden`), logout + linkuri spre celelalte ecrane. **Feature:** `settings`.
- **TZ:** 6 (structura tabului) + 6.3.
- **State:** [Z] `themeStore`, `authStore` · [Q] `useSettings`.

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

> Ștergerea contului (cu confirmare) → `POST /settings/account/delete` este declanșată din hub-ul Setări.

---

## 6. Events / Flirt Passport

### 6.1 Listă evenimente — `app/events/index.tsx`
- **Scop:** evenimentele viitoare (`GET /events`): cover, titlu, dată, oraș, număr participanți. **Feature:** `events`.
- **TZ:** 8.1–8.2.
- **State:** [Q] `useEvents`.

### 6.2 Detaliu eveniment — `app/events/[id].tsx`
- **Scop:** detaliul + hartă **placeholder** + marcaj „merg" (`POST /events/{id}/going`) + check-in QR (`POST /events/{id}/checkin`). **Feature:** `events`.
- **TZ:** 8.2, 8.4.
- **State:** [Q] `useEvent`, `useGoing`, `useCheckin`.

### 6.3 Flirt Passport — `app/passport.tsx`
- **Scop:** grid cu ștampilele confirmate (`GET /events/passport`). **Feature:** `events`.
- **TZ:** 8.4.
- **State:** [Q] `usePassport`.

**🔜 Planificat:** `events/map` — hartă Live Events reală (react-native-maps) cu contor de useri (TZ 8.3); acum harta e placeholder în detaliul evenimentului.

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

# 🔜 Planificat (ecrane din blueprint, neimplementate)

| Ecran | Rută blueprint | Secțiune TZ |
|---|---|---|
| OTP (cod SMS) | `(auth)/otp` | 2.1 |
| Face verify (liveness) | `(auth)/face-verify` | 2.2 |
| Sign-in social (Apple/Google) | `(auth)/sign-in` | 2.1 |
| Send-first-message sheet | overlay la like | 4.7 |
| Deck cu gesturi (swipe/undo/favorite) | tab `ankete` | 4.3–4.5 |
| Event popup card (din deck) | overlay | 4.3, 8.2 |
| Live Events Map | `events/map` | 8.3 |
| Preferences separat / Subscription | `settings/*` | 6.3, 9 |
| Paywall | `paywall` (modal) | 9 |

---

## 8. Matrice ecran real → secțiune TZ

| Ecran (rută reală) | Secțiune TZ |
|---|---|
| `index` (splash) | 1.1 |
| `(auth)/welcome·login·register` | 2.1 (email+parolă) |
| `(onboarding)/index` | 2.4–2.6 |
| `(tabs)/ankete` | 4.1, 4.2, 4.4 |
| `(tabs)/mesaje` + `chat/[id]` | 5.1, 5.2, 5.5 |
| `(tabs)/setari` | 6, 6.3 |
| `profile/edit` | 6.1 |
| `favorites` | 6.1 |
| `ticket` | 6.2 |
| `blocklist` | 6.3 |
| `events/index·[id]` | 8.1, 8.2, 8.4 |
| `passport` | 8.4 |
| `stories/[userId]·new` | 11 |
