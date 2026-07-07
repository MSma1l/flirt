# 01 — Overview: FLIRT — No Regrets

> **Notă:** acest document descrie **viziunea completă din TZ**. Pentru **starea reală implementată** (ce e livrat în MVP vs. roadmap) vezi [`PROGRESS.md`](../PROGRESS.md), iar pentru API/DB reale vezi [`backend/api-spec.md`](./backend/api-spec.md) și [`backend/data-models.md`](./backend/data-models.md). Secțiunile de features neimplementate încă sunt marcate mai jos cu **🔜 Planificat**.

## Ce este FLIRT

**FLIRT** este o aplicație mobilă de dating (iOS / Android) construită în jurul a trei
piloni: mecanica de **swipe**, **analiza de compatibilitate prin AI** și
**evenimentele offline „Flirt Party"** (Live Events). La pornire, aplicația afișează un
splash screen cu logo-ul FLIRT și sloganul **„No Regrets"** (fade-in/fade-out, ~1.5–2.5s
cât se încarcă sesiunea).

Spre deosebire de un dating app clasic, FLIRT nu se oprește la corespondența online:
împinge utilizatorii spre **întâlniri reale la evenimente**, iar la profilul fiecărui
utilizator adaugă istoricul de participare fizică („Flirt Passport").

## Diferențiatori față de concurență

- **Live Events / Flirt Party** — sistem de evenimente offline reale, cu hartă a
  orașului, contor de utilizatori FLIRT care merg la fiecare eveniment și „Flirt
  Passport" (ștampile digitale după participare confirmată).
- **„Chsimțul umorului" ca parametru calculat** — profilul de umor (sarcasm, umor negru,
  meme/internet, intelectual/fin, absurd, bun/naiv, fizic) este stocat ca **vector de
  ponderi** și intră direct în scorul de compatibilitate (20% din Compatibility Score),
  fiind rafinat continuu de AI din analiza conversațiilor.
- **Două scoruri complementare** — *Compatibility Score* (înainte de match, în feed) și
  *Chemistry Score* (calculat exclusiv din dinamica unei conversații deja pornite).
- **AI-asistent de chat** — sugestii de teme de conversație, relansarea dialogurilor
  „stinse" și propuneri de evenimente comune pentru cei doi.

## Platforme

| Platformă | Cerință minimă |
|---|---|
| iOS | 15+ |
| Android | 9.0 (API 28)+ |

Backend și API unic pentru ambele platforme, o singură bază de utilizatori. Implementare
mobilă cross-platform (React Native + Expo).

## Audiență și restricții de vârstă

Aplicația se adresează unui public **urban, orientat spre întâlniri și evenimente
reale**, nu doar spre corespondența online. Vârsta minimă de înregistrare este **16 ani**,
confirmată prin data nașterii, cu separare strictă a grupelor:

- **16–17 ani** — văd doar profiluri din propria grupă de vârstă (16–17), nu au acces la
  statusul „fără obligații", nu pot publica conținut explicit/18+; filtrul de conținut și
  moderarea sunt întărite.
- **18+** — văd doar profiluri 18+.

## Navigare de nivel înalt

După completarea profilului, ecranul principal are un **tab-bar inferior cu 3 tab-uri**:

1. **Profiluri (Ankete)** — stiva de carduri pentru swipe (ecranul default).
2. **Mesaje** — lista de conversații + sugestiile AI.
3. **Setări** — profil, foto, status, biletul de Flirt Party, restul setărilor.

## Feature-uri majore (grupate logic)

### Onboarding și verificare
- Autentificare: **e-mail + parolă** (implementat) + **Sign in with Apple / Google Sign-In /
  telefon + OTP** (implementate ca **stub** funcțional, gata de chei — vezi
  [`INTEGRATIONS.md`](./INTEGRATIONS.md)). **🔜 Planificat:** doar verificarea facială.
- **🔜 Planificat — Verificare de identitate**: selfie sau scurt video live (liveness-check —
  întoarce capul, clipește), comparat cu pozele din profil prin model de **face-matching**
  (ex. AWS Rekognition sau echivalent); badge **„✓ Verificat"** și vizibilitate limitată
  pentru conturile neverificate. Nu există în MVP.
- **Profil obligatoriu** (implementat): nume, dată naștere/vârstă, gen, înălțime, oraș,
  opțional stradă/naționalitate, limbi de comunicare, „despre mine" (max 500 caractere),
  interese (multiselect), status de cunoștință. **Upload de 3–9 fotografii** (implementat prin
  storage abstractizat — stub local gata de S3/GCS; endpoint-urile `/profiles/photos*`).
  Geocodarea orașului este implementată (stub geocoder → distanță Haversine reală).
- **Test de umor** la înscriere (carduri cu tipuri de glume) → vectorul de umor inițial
  (implementat: `/humor/*` scrie `Profile.humor_vector`, care intră cu 20% în Compatibility
  Score). **🔜 Planificat:** rafinarea continuă a vectorului prin NLP din conversații.

### Swipe și compatibilitate
- Card full-screen cu galerie foto (indicatori tip Stories), plăcuță inferioară cu
  nume/vârstă/oraș/distanță/interese, expandare la profilul complet.
- **Compatibility Score** — badge circular cu procent (colorat: verde >80%, galben 50–80%,
  gri <50%), calculat ca sumă ponderată: interese 30%, status 15%, umor 20%, distanță 15%,
  limbi 10%, semnale comportamentale 10% (ponderi configurabile din backend prin
  feature flags).
- **Badge de eveniment** lângă scor dacă utilizatorul a marcat că merge la un eveniment.
- Acțiuni like/dislike prin **butoane** + **gesturi de swipe** (drag stânga/dreapta prin
  `PanResponder` + `Animated`) și **undo** (`POST /feed/undo`) — implementate. `MatchModal` la
  match reciproc. **🔜 Planificat:** favorite direct din deck, galerie multi-foto tip Stories,
  expandare la profil complet, swipe-up.
- **🔜 Planificat — Limită free**: 10 profiluri / sesiune, timer de 15s cu reclamă, Premium
  (swipe nelimitat, fără reclamă). Nu există în MVP (deși modelul `Subscription` există — vezi
  Monetizare).
- **Match**: like reciproc → overlay „Connect! / Match!" (implementat). **Mesaj trimis la like**
  (`SendFirstMessageSheet`), stocat pe `Like.deferred_message` și livrat destinatarului doar
  după like reciproc (deferred, TZ 4.7) — implementat.

### Chat și AI
- Lista de dialoguri cu preview, timestamp, badge necitite (implementat, prin polling).
- Ecran de conversație: bule de mesaje text, input + trimite, mark-read (implementat).
- **Siguranță în chat** — mascarea automată cu asteriscuri a contactelor externe (Instagram/
  Telegram, telefon, email, linkuri) la trimitere (implementat).
- **Reacții pe mesaje** (long-press → picker emoji, `Message.reaction`), **Compatibility Score
  în header + lista de dialoguri** și **raportare din chat** (`ReportModal` → `POST /reports/`)
  — implementate. **🔜 Planificat:** status online, `AI-asistent` (teme de conversație, push
  pentru dialoguri stinse, propuneri de evenimente comune), **Chemistry Score**, realtime
  WebSocket (momentan polling).

### Evenimente și Passport
- Lista de evenimente + detaliu, marcaj „Merg la eveniment", check-in → **Flirt Passport**
  (ștampilă după vizită confirmată) — implementat.
- **Bilet gratuit de Flirt Party** — bilet one-time (cod + QR placeholder) per user,
  emis lazy, în Setări → Biletul meu (implementat).
- **🔜 Planificat:** **Hartă Live Events** (react-native-maps + contor useri), agregare AI a
  evenimentelor din surse publice + moderare, validarea biletului la intrare (redeem).

### Monetizare — ✅ schelet stub (gata de chei), fără plată reală
- **Planuri și entitlements** — modelul `Subscription` + `/subscriptions/*` (plans / me /
  purchase / entitlements) implementate ca **stub** (provider fals, gata de Stripe/App
  Store/Play — vezi [`INTEGRATIONS.md`](./INTEGRATIONS.md)). Pachete: `premium`, `no_ads`,
  `ai_bot`, `all_inclusive`.
- **🔜 Planificat:** aplicarea efectivă a limitelor (10/sesiune, timer 15s, undo nelimitat),
  validarea reală de receipt IAP + webhook-uri, achiziții one-time (boost, super-like-uri).

### Moderare și securitate
- Implementat: **mascarea automată a datelor de contact în chat**; **raportări**
  (spam/fake/offensive/obscene) via `ReportModal` + `POST /reports/` cu **auto-ban** la prag de
  raportori distincți (config) → ascunde profilul; **black list**, **ascundere profil**,
  **ștergere cont** cu perioadă de grație (30 zile, din config); separarea pe vârstă
  16–17 / 18+ în feed (backend).
- **🔜 Planificat:** verificare facială obligatorie; coadă de moderare manuală (admin);
  restricții suplimentare de conținut pentru 16–17.

## Geolocație

**✅ Implementat (stub geocoder).** Orașul e geocodat în coordonate printr-un geocoder
abstractizat (`StubGeocoder`, gata de Google Maps / Mapbox din `.env` — vezi
[`INTEGRATIONS.md`](./INTEGRATIONS.md)), iar distanța se calculează cu formula **haversine** și
apare aproximativ pe card („3 km de tine", câmpul `distance_km`). Adresa exactă nu e niciodată
expusă. **🔜 Planificat:** hartă Live Events cu react-native-maps (TZ 8.3).

## Roadmap (dezvoltare ulterioară)

**Stories (24h)** — deja aduse în MVP (vezi `PROGRESS.md`). Monetizarea, moderarea (raportări +
auto-ban), auth social/OTP, push și geocodarea sunt deja **schelete stub** integrate (gata de
chei). Rămân planificate: cadouri virtuale · niveluri/badge-uri Flirt Passport · evenimente și
chat-uri de grup · verificare facială · AI-asistent de chat (hint / Chemistry Score).

---

**Surse**: `FLIRT TZ.docx` (sarcina tehnică completă), `flirt_paleta_culori.png` (paleta de
culori), `FLIRT Prototype (standalone).html` (prototipul HTML).

Vezi și: [Arhitectura sistemului](./architecture.md) · [Index documentație](./README.md)
