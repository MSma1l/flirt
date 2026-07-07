# FLIRT — Raport de securitate (pentest + remediere)

Audit defensiv (4 dimensiuni, sub-agenți) + remediere + teste de regresie. Status pe fiecare finding.
Legendă: ✅ reparat (cu test) · 🟡 parțial/acceptat · 📋 operațional (la deploy).

## Findings CRITICE
| # | Finding | Status | Fix |
|---|---|---|---|
| C1 | Modul `stub` de auth/OTP/billing poate rula în producție → account takeover, premium gratuit | ✅ | `_guard_production` respinge `stub`/`debug`/`CORS=*` în `environment=production` |
| C2 | Age-gate 16-17/18+ doar în feed; `swipe` accepta orice țintă → contact minor↔adult | ✅ | `_authorize_swipe`: verifică vârstă + block + hidden + completed + self + existență |
| F1 | Zero rate-limiting → brute-force login/OTP, SMS bombing | ✅ | `app/core/ratelimit.py` (app) + `limit_req` în nginx pe `/` și `/auth/` |
| F2 | OTP brute-force (fără limită de încercări) | ✅ | contor încercări per telefon + invalidare la `otp_max_attempts` + cooldown request |

## Findings ÎNALTE
| # | Finding | Status | Fix |
|---|---|---|---|
| F5 | Mesaj deferred la like livrat NEMASCAT → ocolire mascare contacte (TZ 5.5) | ✅ | `mask_contacts` aplicat la livrare + `max_length` pe `SwipeIn.message` |
| S1 | Ștergere/citire arbitrară de obiecte S3 (cheie derivată din URL user) | ✅ | allowlist domeniu `storage_base_url` + prefix `photos/{profile_id}/`; cheia nu se derivă din input |
| U1 | Upload fără validare → stored XSS prin Content-Type | ✅ | allowlist content-type + magic-bytes + tip forțat server-side |
| F6 | Feed DoS: candidați nemărginiți + geocoding per candidat | ✅ | `feed_scan_limit` (SQL) + geocoding doar pe rezultate + cache geocoding |
| F4 | Premium fără enforcement în feed | ✅ | limită `free_daily_swipe_limit`/zi pentru non-premium; premium nelimitat |
| G1 | GDPR: ștergere cont doar „soft", fără purge real | ✅ | `purge_expired_accounts()` — anonimizează/șterge date la `purge_after` (cron) |

## Findings MEDII
| # | Finding | Status | Fix |
|---|---|---|---|
| U2 | Upload fără limită de dimensiune → DoS | ✅ | respinge > `max_upload_bytes` (413) |
| U3 | URL-uri poze arbitrare în anketă + liste nemărginite | ✅ | `is_https_url` + allowlist + `max_photos` + `max_length` pe liste |
| M1 | User blocat scrie în chat existent | ✅ | `_ensure_not_blocked` în `send_message`/`react_to_message` (403) |
| M2 | Enumerare useri (timing la login) | ✅ | `verify_password` pe hash dummy constant → timing uniform + 401 generic |
| M3 | Validare target moderare (raport către user inexistent, chat_id neverificat) | ✅ | 404 target inexistent + participant-check pe chat_id + `max_length` note |
| D1 | `debug=True` în prod → stack traces + SQL cu PII | ✅ | blocat de `_guard_production` |
| CO1 | CORS `allow_credentials=True` + risc `*` | ✅ | guard respinge `*` în prod (auth e pe Bearer) |
| H1 | Lipsă HSTS / TLS forțat în nginx | ✅ | HSTS adăugat + bloc redirect 80→443 (activabil la TLS) |
| J1 | JWKS: fallback pe `keys[0]` la `kid` necunoscut | ✅ | respinge tokenul cu `kid` necunoscut |

## Validare de input universală (XSS / SQLi / lungime / non-gol)
✅ `app/core/validators.py` (`safe_str`, `optional_safe_str`, `is_https_url`) aplicat pe TOATE schemele:
trim automat, non-gol obligatoriu (gol după trim → 422), `max_length` pe fiecare câmp text, respingere
caractere de control și marcaje HTML (anti-XSS stocat). **SQLi**: confirmat 100% ORM parametrizat (zero SQL brut).

## Confirmate SIGURE la audit (fără acțiune)
- JWT RS256 fixat (anti `alg=none`/confusion), refresh rotation + reuse-detection cu revocare pe familie.
- IDOR per-resursă corect (chat/stories/favorites/blocks/settings/subscriptions scopate pe `user.id`).
- Fără mass-assignment (`verified`/`completed` doar server-side; Pydantic ignoră extra).
- Parole Argon2; refresh stocat doar ca SHA-256; token mobil în SecureStore (Keychain/Keystore).
- Fără expunere PII (adresă exactă niciodată; doar distanță; fără email-uri ale altora; fără hash-uri în output).
- Fără SSRF (S3 prin SDK, host ignorat); fără ReDoS (input plafonat 2000); secrete 100% din env.
- Selfie biometric NU e stocat (doar boolean `verified`).

## 📋 Operațional la deploy (config, nu cod)
- Montează TLS + activează redirect 80→443 în `nginx/nginx.conf`.
- Setează `ENVIRONMENT=production`, provideri `live`, `DEBUG=false`, `CORS` explicit (nu `*`) — guard-ul le impune.
- Programează `purge_expired_accounts()` (cron/worker zilnic) pentru GDPR.
- Rate-limiting: în prod folosește Redis (implementarea in-memory e per-proces).

## Teste de regresie de securitate
`test_feed_security.py` · `test_security_hardening.py` · `test_upload_security.py` · `test_block_gdpr_security.py`
+ unit teste extinse (compat/masker/security/scheme). Backend **313 teste verzi**, acoperire ~87%.
