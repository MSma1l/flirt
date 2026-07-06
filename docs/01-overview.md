# 01 — Overview: FLIRT — No Regrets

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
- Autentificare: **Sign in with Apple**, **Google Sign-In**, e-mail + parolă, telefon +
  SMS/OTP.
- **Verificare de identitate obligatorie**: selfie sau scurt video live (liveness-check —
  întoarce capul, clipește), comparat cu pozele din profil prin model de **face-matching**
  (ex. AWS Rekognition sau echivalent).
- Profilurile neverificate au vizibilitate limitată în feed; cele verificate primesc
  badge-ul **„✓ Verificat"**.
- **Profil obligatoriu**: nume, dată naștere/vârstă, gen, înălțime, oraș (geo), opțional
  stradă/cartier, naționalitate, limbi de comunicare, **3–9 fotografii**, „despre mine"
  (max 500 caractere), interese (multiselect), status de cunoștință.
- **Test de umor** la înscriere (5–7 carduri cu tipuri de glume) → vectorul de umor inițial.

### Swipe și compatibilitate
- Card full-screen cu galerie foto (indicatori tip Stories), plăcuță inferioară cu
  nume/vârstă/oraș/distanță/interese, expandare la profilul complet.
- **Compatibility Score** — badge circular cu procent (colorat: verde >80%, galben 50–80%,
  gri <50%), calculat ca sumă ponderată: interese 30%, status 15%, umor 20%, distanță 15%,
  limbi 10%, semnale comportamentale 10% (ponderi configurabile din backend prin
  feature flags).
- **Badge de eveniment** lângă scor dacă utilizatorul a marcat că merge la un eveniment.
- Gesturi: swipe dreapta = like, stânga = dislike, long-press / ★ = favorite, undo (limitat
  la 1 pas în versiunea free), tap = navigare foto, swipe sus = profil complet.
- **Limită free**: 10 profiluri / sesiune, apoi timer de 15s cu reclamă și porție nouă.
  Premium = swipe nelimitat, fără reclamă.
- **Match**: la like se poate trimite imediat un mesaj (afișat destinatarului doar după
  like reciproc); like reciproc → ecran full-screen „Connect! / Match!".

### Chat și AI
- Lista de dialoguri cu preview, timestamp, badge necitite, swipe pentru acțiuni rapide.
- Ecran de conversație: header cu Compatibility Score, mesaje (text/emoji/foto/reacții),
  plăcuță „AI — temă de conversație", câmp de input cu șabloane rapide.
- **AI-asistent (beta)** — sugerează teme (bancă de ~100 teme + generate din interese/status/
  umor comun), trimite push pentru dialoguri stinse, propune evenimente comune, rafinează
  continuu profilul de umor prin NLP.
- **Chemistry Score** — calculat din viteza răspunsurilor, lungimea mesajelor, tonul
  emoțional, umor comun, emoji/reacții; influențează sugestiile AI și viitoarele potriviri.
- **Siguranță în chat** — NLP maschează automat cu asteriscuri contacte externe (Instagram/
  Telegram, telefon, email, linkuri); raportare directă din chat.

### Evenimente și Passport
- Evenimente adăugate din admin-panel sau agregate AI din afișe publice (cu moderare).
- Marcaj „Merg la eveniment" reflectat în feed.
- **Hartă Live Events** — evenimentele apropiate cu contor de utilizatori FLIRT înscriși.
- **Flirt Passport** — ștampilă digitală după participare confirmată (scanare QR la intrare
  sau geo-check-in), crește încrederea și prioritatea în feed.
- **Bilet gratuit de Flirt Party** — un bilet digital one-time (QR/ID unic) per utilizator
  nou, fără expirare, în Setări → Biletul meu.

### Monetizare
- **Premium** — swipe nelimitat, fără timer/reclamă, undo nelimitat, prioritate în feed.
- **Subscription „fără reclamă"** — dezactivează bannere/video (fără ridicarea limitei).
- **AI-bot în chat** — opțiune plătită pentru sugestii/analiză extinse peste limita free.
- **„Totul inclus"** — Premium + fără reclamă + AI-bot la preț redus.
- **Achiziții one-time (viitor)** — boost profil, super-like-uri suplimentare.

### Moderare și securitate
- Verificare facială obligatorie; mascare automată a datelor de contact în chat.
- Raportări (spam, fake, insulte, foto indecente) cu **auto-ban AI** la certitudine ridicată
  și coadă de moderare manuală pentru cazuri ambigue.
- Black list, ascundere profil, ștergere cont (cu perioadă de recuperare, ex. 30 zile).
- Restricții suplimentare de conținut/comunicare pentru grupa 16–17.

## Geolocație

Orașul (și opțional strada/cartierul) sunt geocodate în coordonate (Google Maps / Mapbox),
distanța se calculează cu formula **haversine** și se afișează aproximativ („3 km de tine").
Adresa exactă nu este niciodată vizibilă altor utilizatori.

## Roadmap (dezvoltare ulterioară)

Cadouri virtuale · Stories (24h) · niveluri/badge-uri Flirt Passport · evenimente și
chat-uri de grup.

---

**Surse**: `FLIRT TZ.docx` (sarcina tehnică completă), `flirt_paleta_culori.png` (paleta de
culori), `FLIRT Prototype (standalone).html` (prototipul HTML).

Vezi și: [Arhitectura sistemului](./architecture.md) · [Index documentație](./README.md)
