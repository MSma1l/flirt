# FLIRT — Integrări externe (chei reale necesare)

Fiecare serviciu extern e abstractizat în spatele unei interfețe, cu **DOUĂ** implementări:

- **stub** (implicit) — funcțional fără rețea și fără chei, pentru dev/CI;
- **live** — implementarea reală. **Pui providerul + cheile în `.env` și funcționează.** Zero cod de modificat.

Toate ramurile live sunt **testate cu API-ul extern simulat (mock)** — logica de integrare e verificată
fără chei reale (`backend/tests/test_*_live.py`).

> ⚠️ **Guardul de producție** (`app/core/config.py`) verifică **și cheile, nu doar modul**: dacă pui
> `STORAGE_PROVIDER=s3` dar lași `AWS_SECRET_ACCESS_KEY` gol, aplicația **refuză să pornească**.
> La fel, orice integrare rămasă pe `stub` în producție = eroare de pornire. Vezi [`../SECURITY.md`](../SECURITY.md).

---

## Tabelul cheilor — ce ai nevoie, de unde iei

| Integrare | TZ | Provider (`.env`) | Chei necesare | Cost | De unde o iei |
|---|---|---|---|---|---|
| **Geocoding** | 7 | `GEO_PROVIDER=nominatim` | **NICIUNA** — doar `GEO_USER_AGENT` cu **email real** | **gratuit** | — (OpenStreetMap) |
| **Hărți (mobil)** | 8.3 | — (tiles OSM + Leaflet) | **NICIUNA** | **gratuit** | — (OpenStreetMap) |
| **Storage foto** | 2.4 | `STORAGE_PROVIDER=s3` | `S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | plătit | consola AWS (S3 + IAM) |
| **Verificare facială** | 2.2 | `FACE_VERIFY_PROVIDER=rekognition` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (**aceleași chei ca S3**), `FACE_MATCH_THRESHOLD` | plătit | consola AWS (Rekognition) |
| **Google Sign-In** | 2.1 | `SOCIAL_AUTH_MODE=live` | `GOOGLE_CLIENT_ID` | gratuit | Google Cloud Console |
| **Apple Sign-In** | 2.1 | `SOCIAL_AUTH_MODE=live` | `APPLE_CLIENT_ID` | cont dev | Apple Developer (Sign in with Apple) |
| **Telefon + OTP** | 2.1 | `OTP_MODE=live` | `REDIS_URL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | **plătit per SMS** | consola Twilio |
| **Push Expo** | 6.3 | `PUSH_PROVIDER=expo` | `PUSH_API_KEY` (opțional) | gratuit | Expo |
| **Push FCM** | 6.3 | `PUSH_PROVIDER=fcm` | `FCM_SERVER_KEY` | gratuit | Firebase Console |
| **Billing App Store** | 9 | `BILLING_PROVIDER=app_store` | `APP_STORE_SHARED_SECRET` | comision Apple | App Store Connect → App Information → App-Specific Shared Secret |
| **Billing Stripe** | 9 | `BILLING_PROVIDER=stripe` | `STRIPE_SECRET_KEY` | comision Stripe | Dashboard Stripe |

### Ce NU costă nimic (decizie deliberată)

**Geocoding + hărți sunt 100% gratuite, fără cheie și fără cont.**

Google Maps și Mapbox cer **card bancar** și cont de facturare chiar și pentru nivelul gratuit. Pentru un
produs care încă nu are venit, e o dependență de cost inutilă. Am ales:

- **Hărți (mobil):** `react-native-webview` + **Leaflet** + tiles **OpenStreetMap**. Zero chei.
  Atribuția OSM (`© OpenStreetMap contributors`) e obligatorie prin licența ODbL — **nu o elimina din UI**.
- **Geocoding (backend):** **Nominatim** (OSM). Singura cerință e un `User-Agent` cu un **email real**
  (politica de utilizare OSM). Guardul de producție **refuză** valoarea implicită `contact@example.com` —
  altfel Nominatim ne blochează pe tăcute și geocodarea începe să întoarcă `null` pentru toți userii.

`GEO_PROVIDER=google|mapbox` rămâne implementat, ca opțiune, dacă vreodată devine necesar
(`GEO_API_KEY` obligatoriu în acel caz).

---

## Limitări cunoscute

| Ce | Detaliu |
|---|---|
| **Google Play Billing** | ❌ **NEIMPLEMENTAT.** `BILLING_PROVIDER=play` **trece de guard**, dar ridică `NotImplementedError` (→ 500) la prima achiziție de pe Android. Doar `stripe` și `app_store` sunt implementate în `app/services/billing.py`. Play necesită un service account Google. |
| **IAP nativ (mobil)** | ❌ Amânat de client. Backend-ul validează receipt-uri; **aplicația nu are niciun SDK de plată**. Consecință: **fără IAP nu se poate face submit la App Store** (Guideline 3.1.1). Vezi [`../PROGRESS.md`](../PROGRESS.md). |
| **Login social nativ** | ❌ Amânat. Backend-ul verifică JWKS real (Google + Apple); pe mobil, `socialAuth.ts` întoarce token-uri **stub**. Guideline 4.8: dacă oferi Google, Apple cere **obligatoriu** și Sign in with Apple. |
| **Cameră / selfie** | ❌ Amânat. Rekognition e gata pe backend; mobilul trimite un marcaj JSON, **nicio imagine nu e capturată**. |
| **Reclame** | Niciun SDK de reclame. Planul `no_ads` nu are încă un sens real. |

---

## Cum pornești în producție

```bash
cd backend
cp .env.production.example .env
chmod 600 .env
nano .env        # completează tot ce e marcat cu  <<< COMPLETEAZĂ >>>
make config      # validează .env FĂRĂ să pornească nimic
docker compose up --build -d
```

`.env.production.example` conține **toate** variabilele cerute de guard, fiecare cu explicație și cu
locul de unde se ia cheia. `make config` îți spune exact ce lipsește — nu pornește tăcut cu o
configurare pe jumătate.

Migrațiile rulează automat la pornire (`alembic upgrade head` în `entrypoint.sh`).
Procedura completă: [`DEPLOYMENT.md`](./DEPLOYMENT.md).

---

## Dependențe live

`pip install .[live]` → `httpx`, `boto3`, `redis`.

| Dependență | Cine o folosește |
|---|---|
| `httpx` | geocoding (Nominatim/Google/Mapbox), JWKS (Google/Apple), SMS Twilio, push (Expo/FCM), billing (Stripe/App Store) |
| `boto3` | S3 (storage foto) + Rekognition (verificare facială) |
| `redis` | rate-limiting partajat între workeri + store OTP |

Importate **lazy**, în ramura live — modul stub/dev nu depinde de ele.
În imaginea Docker sunt instalate din start (`[project.dependencies]` + extra `live`).

---

## Decizii de business rămase

- **Prețuri finale** ale abonamentelor (acum în config: `PRICE_PREMIUM=9.99`, `PRICE_NO_ADS=3.99`,
  `PRICE_AI_BOT=4.99`, `PRICE_ALL_INCLUSIVE=14.99` EUR/lună).
- **Google Play billing** — necesită service account (vezi „Limitări cunoscute").
- **Hosting-ul datelor biometrice** (GDPR) pentru verificarea facială. Momentan nu stocăm niciun selfie —
  doar boolean-ul `verified` — deci problema e amânată odată cu camera.
- **Rețea de reclame** (dacă se păstrează planul `no_ads` și timerul de 15s din TZ 4.5).
- **Cheia AI** pentru hint-ul de conversație și Chemistry Score (TZ 5.3/5.4): decis **Anthropic**. Neînceput.

---

Vezi și: [`DEPLOYMENT.md`](./DEPLOYMENT.md) · [`../SECURITY.md`](../SECURITY.md) · [`../PROGRESS.md`](../PROGRESS.md)
