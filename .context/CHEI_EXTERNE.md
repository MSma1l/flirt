# FLIRT — Chei externe: ce trebuie, de unde, cât costă

Context pentru proiect, alături de `TZ.txt` și `DESIGN_TOKENS.md`.

**Regula de aur:** aplicația **pornește și fără majoritatea cheilor** — doar funcțiile care le folosesc rămân inactive. Guardul de producție (`app/core/config.py` → `_guard_production`) refuză să pornească dacă un provider e activat dar cheile lui lipsesc, deci nu poți greși în tăcere.

---

## ✅ DEJA REZOLVATE — nu trebuie să faci nimic

| Ce | Cum e rezolvat | Cost |
|---|---|---|
| **Chei JWT (RS256)** | Generate automat pe server (`/etc/flirt/keys/`). Nu circulă nicăieri, nu sunt în repo. | gratuit |
| **Hărți** (mobil) | OpenStreetMap + Leaflet prin WebView. **Fără cheie, fără cont.** | gratuit |
| **Geocoding** (backend) | Nominatim (OpenStreetMap). `GEO_PROVIDER=nominatim`. **Fără cheie.** | gratuit |
| **Certificat HTTPS** | Let's Encrypt, emis și reînnoit automat de certbot. | gratuit |
| **Postgres + Redis** | Rulează în docker-compose pe serverul tău. | gratuit |

> Google Maps și Mapbox au fost respinse **intenționat**: ambele cer card bancar. OpenStreetMap face aceeași treabă pentru cazul nostru (distanțe + hartă la eveniment), gratuit și fără dependență de nimeni.

---

## 🔑 DE PROCURAT — în ordinea în care contează

### 1. AWS (S3 + Rekognition) — pentru pozele de profil
- **Unde:** https://console.aws.amazon.com/ → IAM → Access Keys
- **Cost:** free tier 12 luni, dar **cere card bancar** la înregistrare
- **Variabile:** `S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- **Activează:** `STORAGE_PROVIDER=s3`
- **Fără ea:** nu se pot încărca poze de profil. Aplicația merge, dar profilurile rămân fără fotografii — ceea ce pentru o aplicație de dating înseamnă că practic nu funcționează.
- **Bonus:** aceeași cheie acoperă și **Rekognition** (verificarea prin selfie) — `FACE_VERIFY_PROVIDER=rekognition`. Nu-ți trebuie un al doilea cont.

### 2. Google OAuth Client ID — login cu Google
- **Unde:** https://console.cloud.google.com/ → APIs & Services → Credentials → OAuth 2.0 Client ID
- **Cost:** **GRATUIT, fără card**
- **Variabilă:** `GOOGLE_CLIENT_ID`
- **Activează:** `SOCIAL_AUTH_MODE=live`
- ⚠️ **Atenție:** dacă adaugi login Google, **Apple te OBLIGĂ** să adaugi și Sign in with Apple (Guideline 4.8). Vin la pachet.

### 3. Apple Developer — Sign in with Apple + plăți IAP
- **Unde:** https://developer.apple.com/
- **Cost:** **99 $/an**
- **Variabile:** `APPLE_CLIENT_ID` (Services ID), `APP_STORE_SHARED_SECRET`
- **Fără el:** nu poți publica în App Store. Deloc.

### 4. Twilio — SMS pentru codul OTP
- **Unde:** https://www.twilio.com/console
- **Cost:** trial cu credit, **cere card pentru producție**
- **Variabile:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`
- **Activează:** `OTP_MODE=live`
- **Fără ea:** înregistrarea prin telefon nu funcționează. Email + parolă merge normal.

### 5. Anthropic — funcțiile AI din TZ
- **Unde:** https://console.anthropic.com/
- **Cost:** plată la consum
- **Variabilă:** `ANTHROPIC_API_KEY`
- **Acoperă TOT ce lipsește din TZ, cu o singură cheie:**
  - `claude-haiku-4-5` → AI-hints în chat (TZ 5.3) + moderare de text · $1 in / $5 out per 1M tokens
  - `claude-sonnet-5` → Chemistry Score (TZ 5.4), rulat **offline în Batch API (−50%)** · $3 in / $15 out
- **Principiu de arhitectură:** LLM-ul produce **doar feature-uri precalculate**. Ranking-ul feed-ului rămâne aritmetică rapidă — **niciodată** un LLM în calea critică a unei cereri de feed (ar fi lent, scump și nedeterminist).
- **Anthropic NU are embeddings.** Dacă vrei potrivire semantică pe textul liber „despre mine" (azi complet neexploatat de algoritm), ai nevoie de o a doua cheie: Voyage AI sau OpenAI. **Amânat intenționat** — e treapta 3 de evoluție, nu blochează lansarea.

### 6. Push notifications
- **Expo Push:** `PUSH_API_KEY` — https://expo.dev → Access Token. **Gratuit, fără card.**
- **FCM (alternativă):** `FCM_SERVER_KEY` — https://console.firebase.google.com. **Gratuit, fără card.**

---

## ⚠️ Capcane reale, verificate în cod

1. **`GEO_USER_AGENT` NU poate rămâne `example.com`.** Politica Nominatim cere un contact real; cu valoarea implicită, **OSM te blochează**. Guardul refuză pornirea dacă e nesetat.
2. **`REDIS_URL` e OBLIGATORIU în producție** — fără el, rate-limiting-ul cade tăcut pe in-memory, iar cu mai mulți workeri gunicorn limita reală devine de N ori cea configurată. Adică protecția anti-brute-force nu există.
3. **`BILLING_PROVIDER=play` trece de guard dar crapă la runtime** — codul implementează doar `stripe` și `app_store`. O achiziție de pe Android ar da 500.
4. **Un `.env` copiat dar NECOMPLETAT e respins la pornire.** Valorile `<<< COMPLETEAZĂ >>>` sunt detectate — nu mai poți porni „aparent sănătos" și crăpa la primul login.
5. **Stripe NU poate fi folosit pentru abonamente în aplicația iOS** (App Store Guideline 3.1.1 — conținutul digital se vinde doar prin IAP). Stripe rămâne valid doar pentru web.

---

## Unde se pun

Pe server: `/opt/flirt/backend/.env` (chmod 600).
Șablon complet, cu URL-ul providerului lângă fiecare variabilă: `backend/.env.production.example`.

După ce adaugi o cheie:
```bash
cd /opt/flirt/backend && docker compose up -d
```
