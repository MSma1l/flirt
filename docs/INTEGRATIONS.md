# FLIRT — Integrări externe (puncte de conectare)

Toate serviciile externe sunt abstractizate în spatele unei interfețe, cu o
**implementare stub** funcțională (fără rețea/chei). La deploy, setezi providerul și
cheile în `.env` (vezi `backend/.env.example`) și implementezi metoda `live`/provider
marcată cu `NotImplementedError`. Nimic nu e hardcodat — totul din `app/core/config.py`.

| Integrare | TZ | Config (`.env`) | Cod (abstracție) | Stub face | Ce adaugi pentru „live" |
|---|---|---|---|---|---|
| **Storage foto** | 2.4 | `STORAGE_PROVIDER=s3`, `S3_*`, `AWS_*` | `app/services/storage.py` | întoarce URL fals `STORAGE_BASE_URL/...` | client boto3 în `S3Storage.save/delete` |
| **Geolocație / geocoding** | 7 | `GEO_PROVIDER=google\|mapbox`, `GEO_API_KEY` | `app/services/geo.py` | tabel de orașe → coord + haversine | apel API în `geocode()`; haversine rămâne |
| **Google Sign-In** | 2.1 | `SOCIAL_AUTH_MODE=live`, `GOOGLE_CLIENT_ID` | `app/services/auth_providers.py` | „token = email de test" | validare `id_token` cu JWKS Google |
| **Apple Sign-In** | 2.1 | `SOCIAL_AUTH_MODE=live`, `APPLE_CLIENT_ID` | `app/services/auth_providers.py` | idem | validare JWT Apple (JWKS) |
| **Telefon + OTP** | 2.1 | `OTP_MODE=live`, `SMS_API_KEY` | `app/services/auth_providers.py` | cod fix `OTP_TEST_CODE`, store in-memory | trimitere SMS + store în Redis |
| **Push notifications** | 6.3 | `PUSH_PROVIDER=expo\|fcm`, `PUSH_API_KEY` | `app/services/push.py` | doar loghează | client Expo/FCM în `send_to_user` |
| **Billing / abonamente** | 9 | `BILLING_PROVIDER=stripe\|app_store\|play`, `BILLING_API_KEY` | `app/services/billing.py` | „cumpără" instant (30 zile) | verificare receipt / webhook provider |
| **Verificare facială** | 2.2 | `FACE_VERIFY_PROVIDER=rekognition` | *(punct rezervat)* | — | liveness + face-match (AWS Rekognition/alt) |
| **Realtime chat** | 5 | — | *(momentan polling React Query)* | polling la 3-5s | WebSocket / push la mesaj nou |

## Principiu
Fiecare `get_<serviciu>()` alege implementarea după `settings.<provider>`. Valoarea
`stub` e implicită și menține aplicația 100% funcțională în dev/CI fără chei. Trecerea
la producție = schimbi variabila de mediu + completezi cheia + implementezi ramura
providerului (marcată explicit în cod cu `NotImplementedError` și un comentariu „aici").

## Decizii de business rămase (necesită input)
- Provider concret pentru verificarea facială + retenția datelor biometrice (GDPR).
- Prețuri reale abonamente (acum placeholder în `billing.PLANS`).
- Sursă evenimente: doar admin sau agregare din afișe externe.
