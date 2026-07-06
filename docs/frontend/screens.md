# FLIRT — Ecrane (mapate pe TZ)

> Vezi și: [`README.md`](./README.md) · [`navigation.md`](./navigation.md) · [`styling.md`](./styling.md)

Fiecare ecran e descris prin: **scop**, **componente cheie**, **feature din TZ acoperit**, **state necesar**. Ecranele trăiesc în `features/*/screens`, iar rutele din `src/app/` doar le compun.

Legendă state: **[Q]** = React Query (state server) · **[Z]** = Zustand (state client) · **[F]** = form local (react-hook-form) · **[S]** = socket realtime.

---

## 0. Splash

- **Rută:** `app/index.tsx`
- **Scop:** ecran de încărcare cu logo FLIRT centrat + slogan "No Regrets", fade-in/fade-out cât timp se încarcă sesiunea (1.5–2.5s). Apoi redirect (vezi guard-uri în [`navigation.md`](./navigation.md)).
- **Componente cheie:** `LogoMark`, `Tagline`, animație de opacitate (Reanimated).
- **TZ:** 1.1 (splash + slogan).
- **State:** [Q] `useSession()` (validare token) · [Z] `sessionStore` (setează userul curent).

---

## 1. Onboarding

### 1.1 Welcome / alegere metodă de login
- **Rută:** `app/(auth)/welcome.tsx` · **Feature:** `auth`
- **Scop:** ecran de start cu opțiunile de autentificare.
- **Componente cheie:** `SocialButton` (Apple, Google), `Button` (phone, email), branding.
- **TZ:** 2.1 (Apple / Google / e-mail / telefon).
- **State:** — (navigație).

### 1.2 Sign-in (email / phone / social)
- **Rută:** `app/(auth)/sign-in.tsx` · **Feature:** `auth`
- **Scop:** formular de login/înregistrare în funcție de metoda aleasă; verificarea vârstei prin data nașterii (min. 16 ani).
- **Componente cheie:** `Input`, `Button`, `AppleAuthButton`, `GoogleAuthButton`.
- **TZ:** 2.1 (metode de intrare), 2.3 (vârstă minimă la înregistrare).
- **State:** [F] credențiale · [Q] `useSignIn` mutație · [Z] `sessionStore`.

### 1.3 OTP (cod SMS)
- **Rută:** `app/(auth)/otp.tsx` · **Feature:** `auth`
- **Scop:** introducerea codului SMS/OTP la login prin telefon.
- **Componente cheie:** `OtpInput`, timer de retrimitere.
- **TZ:** 2.1 (telefon + SMS/OTP).
- **State:** [F] cod · [Q] `useVerifyOtp`.

### 1.4 Face verification (liveness-check)
- **Rută:** `app/(auth)/face-verify.tsx` · **Feature:** `auth`
- **Scop:** selfie sau scurt video live (întoarce capul, clipește), trimis la face-matching. Pas obligatoriu pentru conturi noi; până la verificare contul e "neconfirmat" (vizibilitate limitată).
- **Componente cheie:** `LivenessCamera` (expo-camera), instrucțiuni pas-cu-pas, indicator de progres, stare succes/eșec.
- **TZ:** 2.2 (verificare identitate, liveness, badge "✓ Verificat").
- **State:** [Q] `useFaceVerify` (upload + poll rezultat) · [Z] `sessionStore.verificationStatus`.

### 1.5 Profile setup — wizard anketă (multi-pas)
- **Rută:** `app/(auth)/profile-setup/*` · **Feature:** `onboarding`
- **Scop:** completarea anketei obligatorii, împărțită pe pași cu bară de progres; draft persistat local ca să nu se piardă.
- **Pași și componente:**
  | Pas | Rută | Câmpuri (TZ 2.4–2.7) | Componente cheie |
  |---|---|---|---|
  | Basics | `basics` | nume, dată naștere, gen, înălțime | `Input`, `DatePicker`, `GenderPicker` |
  | Location | `location` | oraș (geo), stradă/cartier (opțional) | `CityAutocomplete`, `Input` |
  | Photos | `photos` | 3–9 fotografii | `PhotoGrid`, `PhotoPicker` |
  | About | `about` | despre (≤500), naționalitate, limbi | `TextArea`, `LanguageMultiSelect` |
  | Interests | `interests` | multiselect din lista de interese | `InterestChip` (multiselect) |
  | Status | `status` | status de cunoștință (1+) | `StatusPicker` (16–17 fără "fără obligații") |
  | Humor | `humor` | test 5–7 carduri cu glume | `HumorCard` (swipe/tap) |
- **TZ:** 2.4 (câmpuri obligatorii), 2.5 (interese), 2.6 (status — restricție 16–17), 2.7 (test simț al umorului → vector de umor).
- **State:** [F]/[Z] `onboarding.store` (draft-ul între pași, persistat) · [Q] `useSaveProfile` la final.

---

## 2. Tab 1 — Ankete (Swipe deck)

### 2.1 Deck screen (swipe)
- **Rută:** `app/(tabs)/deck/index.tsx` · **Feature:** `swipe`
- **Scop:** ecranul principal de swipe — stiva de carduri full-screen cu mecanica de like/dislike/favorite.
- **Componente cheie:**
  - `SwipeCard` — card full-screen, foto pe tot ecranul.
  - `PhotoStories` — mai multe foto per persoană, `ProgressDots` sus (tap pe foto = următoarea).
  - `CardInfoOverlay` — plajă gradient jos: nume, vârstă, oraș/distanță, "despre" scurt, top-3 interese.
  - `CompatBadge` — badge rotund cu % în dreapta-sus (verde >80 / galben 50–80 / gri <50).
  - `EventBadge` — iconiță eveniment lângă % (dacă userul merge la un eveniment) → deschide `EventPopupCard`.
  - `ActionBar` — butoane like / dislike / favorite (★) / undo.
  - `FullProfileSheet` — swipe-up pe plaja de jos = anketă completă (toate foto, interese, status, limbi, înălțime).
  - `AdInterstitial` — overlay reclamă + timer 15s (userii free, după 10 ankete).
- **Gesturi (gesture-handler + Reanimated):** swipe-right = like, swipe-left = dislike, swipe-up = anketă completă, long-press / ★ = favorite, tap pe foto = navighează foto, tap pe săgeata stânga-sus = undo (1 pas la free).
- **TZ:** 4.1 (card), 4.2 (Compatibility Score + culori), 4.3 (badge eveniment + popup), 4.4 (gesturi/acțiuni + undo), 4.5 (limită 10 + reclamă 15s + premium unlimited), 4.6 (afișarea %).
- **State:** [Q] `useDeckQueue` (porție de 10, paginare) · [Z] `swipe.store` (index curent, contor limită, favorite, undo stack) · [Q] `useLike/useDislike/useFavorite` (mutații optimiste) · [Z] `sessionStore.entitlements` (free vs premium pentru limită/reclamă).

### 2.2 Event popup card (din deck)
- **Component (overlay), nu rută separată** · **Feature:** `events`
- **Scop:** la tap pe `EventBadge` — card cu nume, dată, loc + buton "Tot iau parte".
- **TZ:** 4.3, 8.2.
- **State:** [Q] `useEvent(eventId)` · [Q] `useAttend`.

---

## 3. Match / Connect

### 3.1 Send-first-message sheet (la like)
- **Component (bottom sheet)** · **Feature:** `match`
- **Scop:** la swipe-right apare "Trimite un mesaj acum?" cu variante gata ("Salut 👋", "Salut, cu ce te ocupi?", text propriu). Mesajul pleacă, dar devine vizibil destinatarului doar după ce dă și el like.
- **Componente cheie:** `QuickReplies`, `Input`, `Button`.
- **TZ:** 4.7 (mesaj la like, livrare amânată).
- **State:** [Q] `useSendPendingMessage`.

### 3.2 Connect popup (match reciproc)
- **Component (overlay full-screen)** · **Feature:** `match`
- **Scop:** la like reciproc — notificare full-screen "Connect! / Ai un Match!" cu foto ambilor + buton "Scrie mesaj". Mesajele amânate devin vizibile automat.
- **Componente cheie:** `ConnectPopup`, animație Lottie, `Avatar` x2, `Button` → `messages/[chatId]`.
- **TZ:** 4.7 (Match, notificare full-screen, coada de like-uri amânate).
- **State:** [S] eveniment socket "match" · [Q] invalidare listă de chat-uri.

---

## 4. Tab 2 — Mesaje

### 4.1 Chat list (lista de dialoguri)
- **Rută:** `app/(tabs)/messages/index.tsx` · **Feature:** `chat`
- **Scop:** lista de conversații: foto rotundă, nume, preview ultim mesaj, timestamp, badge necitite. Swipe pe rând = acțiuni rapide (arhivează / raportează / șterge).
- **Componente cheie:** `ChatRow`, `SwipeableRow`, `UnreadBadge`, `EmptyState`.
- **TZ:** 5.1.
- **State:** [Q] `useChats` · [Z] `chat.store.unread` · [S] update-uri realtime (ultim mesaj/necitite).

### 4.2 Chat screen (ecran de conversație)
- **Rută:** `app/(tabs)/messages/[chatId].tsx` · **Feature:** `chat`
- **Scop:** conversația 1:1 cu AI-hints și protecții de securitate.
- **Componente cheie:**
  - `ChatHeader` — foto, nume, status online/recent, Compatibility Score, buton spre anketa completă.
  - `MessageList` — bule text/emoji/foto, reacții/like pe mesaj.
  - `MessageBubble` — cu suport reacții.
  - `AiHintBanner` — plajă sus "AI-temă pentru discuție" (nu se trimite automat; doar sugestie).
  - `EventSuggestionBanner` — banner "Mergeți împreună la [eveniment], data" + "Propune să mergeți".
  - `MaskedContactHint` — explicație discretă când un contact (telegram/telefon/email/link) e mascat cu ***.
  - `QuickReplies` + `Composer` — câmp de input cu șabloane rapide.
  - `ReportButton (⚠)` — raportare: spam / profil fake / jigniri / foto indecente.
- **TZ:** 5.2 (elementele ecranului), 5.3 (AI-asistent + sugestii temă + banner eveniment), 5.4 (Chemistry Score — folosit intern la prioritizarea hint-urilor), 5.5 (mascare contacte, raportare).
- **State:** [Q] `useMessages` (infinite query, istoric) · [S] `useChatSocket` (mesaje live, typing) · [Q] `useAiHints` · [Q] `useSendMessage` (mutație optimistă) · [Z] draft mesaj.

---

## 5. Tab 3 — Setări / Profil

### 5.1 Settings menu (+ profil)
- **Rută:** `app/(tabs)/settings/index.tsx` · **Feature:** `settings`
- **Scop:** hub-ul de setări + acces la profil, bilet, abonament, preferințe.
- **Componente cheie:** `ProfileHeader`, `SettingRow` (listă), secțiuni.
- **TZ:** 6 (structura tab-ului Setări).
- **State:** [Q] `useMe` · [Z] `sessionStore`.

### 5.2 Profile edit
- **Rută:** `app/(tabs)/settings/profile-edit.tsx` · **Feature:** `profile`
- **Scop:** editarea anketei: foto (adaugă/șterge/reordonează), toate câmpurile 2.4–2.7, status de cunoștință, marcarea "merg la eveniment".
- **Componente cheie:** `PhotoGrid` (drag-reorder), `FieldEditor`, `StatusPicker`, `InterestChip`, `EventAttendPicker`.
- **TZ:** 6.1 (profil), 8.2 (marcare eveniment în anketă).
- **State:** [F] formular · [Q] `useUpdateProfile`.

### 5.3 Favorites
- **Rută:** `app/(tabs)/settings/favorites.tsx` · **Feature:** `profile`
- **Scop:** lista de ankete favorite (adăugate prin long-press / ★ în deck).
- **Componente cheie:** `FavoriteCard` grid.
- **TZ:** 4.4, 6.1 (lista de favorite).
- **State:** [Q] `useFavorites` · [Z] `swipe.store.favorites`.

### 5.4 Ticket (bilet Flirt Party)
- **Rută:** `app/(tabs)/settings/ticket.tsx` · **Feature:** `settings`
- **Scop:** biletul digital unic gratuit (QR / ID) care nu expiră până la folosire la intrarea la eveniment.
- **Componente cheie:** `TicketQr`, `TicketStatus`.
- **TZ:** 6.2 (bilet Flirt Party).
- **State:** [Q] `useTicket`.

### 5.5 Preferences (setări generale)
- **Rută:** `app/(tabs)/settings/preferences.tsx` · **Feature:** `settings`
- **Scop:** temă (light/dark/system), notificări push (match/mesaje/AI/evenimente/reclame), lista neagră, ascunde profil, ștergere cont (cu perioadă de restaurare), schimbare metodă de intrare, limbi/regiune, radius de căutare (km), gestiune abonament.
- **Componente cheie:** `ThemeSelector`, `NotificationToggles`, `BlacklistManager`, `Switch`, `RadiusSlider`, `SettingRow`.
- **TZ:** 6.3 (setări generale) + link către 9 (abonamente), 7 (radius).
- **State:** [Z] `themeStore`, `filtersStore` · [Q] `usePreferences`, `useBlacklist` · [Z] `sessionStore`.

### 5.6 Subscription (gestiune abonament)
- **Rută:** `app/(tabs)/settings/subscription.tsx` · **Feature:** `subscription`
- **Scop:** starea abonamentului curent, gestiune, acces la Paywall.
- **TZ:** 6.3 + 9.
- **State:** [Q] `useEntitlements` · `usePurchases`.

---

## 6. Events / Map / Flirt Passport

### 6.1 Events list
- **Rută:** `app/events/index.tsx` · **Feature:** `events`
- **Scop:** lista evenimentelor apropiate (Flirt Party / concerte / altele).
- **Componente cheie:** `EventCard` (cover, nume, dată, loc, nr. useri FLIRT care merg).
- **TZ:** 8.1 (surse), 8.2.
- **State:** [Q] `useEvents`.

### 6.2 Event detail
- **Rută:** `app/events/[eventId].tsx` · **Feature:** `events`
- **Scop:** detaliul unui eveniment + "Tot iau parte".
- **Componente cheie:** cover, descriere, dată/loc, `AttendButton`, listă useri care merg.
- **TZ:** 8.2.
- **State:** [Q] `useEvent`, `useAttend`.

### 6.3 Live Events Map
- **Rută:** `app/events/map.tsx` · **Feature:** `events`
- **Scop:** hartă a orașului cu evenimentele apropiate și numărul de useri FLIRT deja marcați pe fiecare (potențial de cunoștințe pe loc).
- **Componente cheie:** `MapView` (react-native-maps), `MapMarker` (cu contor useri), `EventPreviewSheet`.
- **TZ:** 8.3.
- **State:** [Q] `useEventsMap` · [Q]/[hook] `useLocation` (poziție + permisiuni).

### 6.4 Flirt Passport
- **Rută:** `app/events/passport.tsx` · **Feature:** `events`
- **Scop:** ștampilele digitale primite după participarea reală confirmată (QR la intrare / geo-marcaj). Cresc încrederea/prioritatea în afișare.
- **Componente cheie:** `PassportStamp` grid, `PassportStats`.
- **TZ:** 8.4.
- **State:** [Q] `usePassport`.

---

## 7. Paywall

- **Rută:** `app/paywall.tsx` (modal) · **Feature:** `subscription`
- **Scop:** prezentarea planurilor și achiziția. Invocat când userul free lovește limita de 10 ankete, cere undo nelimitat, sau din Setări → Abonament.
- **Componente cheie:** `PlanCard` x N (Premium, Fără reclame, AI-bot, "Tot inclus"), `FeatureRow` (comparație beneficii), CTA gradient roz, restore purchases.
- **TZ:** 9 (modelul de monetizare: Premium / fără reclame / AI-bot / combinat; bust & super-like ca "viitor").
- **State:** [Q] `useOfferings` (planuri din IAP/RevenueCat) · `usePurchase`, `useRestore` · [Z] `sessionStore.entitlements` (actualizat după achiziție).

---

## 8. Matrice ecran → secțiune TZ (rezumat)

| Ecran | Secțiune TZ |
|---|---|
| Splash | 1.1 |
| Welcome / Sign-in / OTP | 2.1, 2.3 |
| Face verify | 2.2 |
| Profile setup (wizard) | 2.4, 2.5, 2.6, 2.7 |
| Deck (swipe) | 4.1–4.6 |
| Event popup (deck) | 4.3, 8.2 |
| Send-first-message sheet | 4.7 |
| Connect popup (match) | 4.7 |
| Chat list | 5.1 |
| Chat screen | 5.2, 5.3, 5.4, 5.5 |
| Settings menu | 6 |
| Profile edit | 6.1, 8.2 |
| Favorites | 4.4, 6.1 |
| Ticket | 6.2 |
| Preferences | 6.3, 7 |
| Subscription | 6.3, 9 |
| Events list / detail | 8.1, 8.2 |
| Events map | 8.3 |
| Flirt Passport | 8.4 |
| Paywall | 9 |
