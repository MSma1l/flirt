# FLIRT — Integrări externe (LIVE + stub)

Fiecare serviciu extern e abstractizat în spatele unei interfețe, cu **DOUĂ** implementări:
- **stub** (implicit) — funcțional fără rețea/chei, pentru dev/CI;
- **live** — implementarea reală. **Tu doar pui providerul + cheile în `.env` și funcționează.**

Comutarea se face din config (`app/core/config.py` / `.env`), zero cod de modificat. Toate
ramurile live sunt **testate cu API-ul extern simulat (mock)** — logica de integrare e verificată
fără chei reale (vezi `backend/tests/test_*_live.py`).

| Integrare | TZ | Provider (`.env`) | Chei necesare | Implementare live | Test |
|---|---|---|---|---|---|
| **Storage foto** | 2.4 | `STORAGE_PROVIDER=s3` | `S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | `S3Storage` (boto3: put/delete_object) | `test_storage_live.py` |
| **Verificare facială** | 2.2 | `FACE_VERIFY_PROVIDER=rekognition` | `AWS_*`, `FACE_MATCH_THRESHOLD` | `RekognitionFaceVerifier` (compare_faces) | `test_face_verify.py` |
| **Geocoding** | 7 | `GEO_PROVIDER=google\|mapbox` | `GEO_API_KEY` | Google/Mapbox Geocoding (httpx) + haversine | `test_geo_live.py` |
| **Google Sign-In** | 2.1 | `SOCIAL_AUTH_MODE=live` | `GOOGLE_CLIENT_ID` | verificare `id_token` cu JWKS Google (jose) | `test_auth_live.py` |
| **Apple Sign-In** | 2.1 | `SOCIAL_AUTH_MODE=live` | `APPLE_CLIENT_ID` | verificare JWT Apple (JWKS) | `test_auth_live.py` |
| **Telefon + OTP** | 2.1 | `OTP_MODE=live` | `REDIS_URL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | cod în Redis (TTL) + SMS Twilio (httpx) | `test_auth_live.py` |
| **Push Expo** | 6.3 | `PUSH_PROVIDER=expo` | `PUSH_API_KEY` (opțional) | Expo Push API (httpx) | `test_push_billing_live.py` |
| **Push FCM** | 6.3 | `PUSH_PROVIDER=fcm` | `FCM_SERVER_KEY` | FCM send (httpx) | `test_push_billing_live.py` |
| **Billing Stripe** | 9 | `BILLING_PROVIDER=stripe` | `STRIPE_SECRET_KEY` | verificare checkout session (httpx) | `test_push_billing_live.py` |
| **Billing App Store** | 9 | `BILLING_PROVIDER=app_store` | `APP_STORE_SHARED_SECRET` | verifyReceipt (httpx, status==0) | `test_push_billing_live.py` |

## Cum pornești în producție
1. `cp backend/.env.example backend/.env` și completează cheile pentru providerii doriți.
2. Setează `ENVIRONMENT=production` (un guard refuză pornirea cu default-uri nesigure).
3. Deploy: `docker compose up --build` (imaginea instalează `pip install .[live]` — boto3/redis/httpx incluse).
4. Migrații: rulează automat la pornire (`alembic upgrade head` în entrypoint).

## Dependențe live
`pip install .[live]` → `httpx`, `boto3`, `redis`. HTTP-based (geo, auth JWKS, OTP SMS, push, billing)
folosesc `httpx`; S3/Rekognition folosesc `boto3`; store OTP folosește `redis`. Importate **lazy**
în ramura live, deci modul stub/dev nu depinde de ele.

## De făcut încă (UI mobil, nu backend)
Backend-ul e complet driven din `.env`. Mai rămâne **UI mobil** pentru: paywall abonamente,
butoane login social (Google/Apple), înregistrare device push, ecran verificare facială (selfie).
Endpoint-urile backend există deja pentru toate.

## Decizii de business rămase
- Hosting date biometrice (GDPR) pentru verificarea facială.
- Prețuri finale abonamente (acum în config: `PRICE_*`).
- Google Play billing (App Store + Stripe implementate; Play necesită service account).
