# Securitate — Backend FLIRT ("No Regrets")

> Documentație de securitate pentru backend-ul FastAPI al aplicației FLIRT.
> Textul explicativ este în română; numele de câmpuri, claim-urile JWT, codul și identificatorii sunt în engleză.
>
> **Acest document descrie ce este IMPLEMENTAT în cod.** Ce e doar planificat sau recomandat e marcat explicit cu 🔜. Dacă găsești o divergență între document și cod, **codul are dreptate** — raportează divergența.
>
> Documente conexe:
> - [`docs/backend/README.md`](./README.md) — arhitectură generală backend, stack, structura reală de foldere.
> - [`docs/backend/data-models.md`](./data-models.md) — modele de date, în special **`RefreshSession`** (`app/models/session.py`).
> - [`docs/backend/api-spec.md`](./api-spec.md) — endpoint-urile REST.
> - [`docs/DEPLOYMENT.md`](../DEPLOYMENT.md) — TLS, nginx, `.env` de producție.
>
> Referințe TZ: verificare identitate **2.2**, ~~restricții de vârstă **2.3**~~ (OBSOLET — vezi 4.4), mascare contacte **5.5**, moderare **10**, geolocație **7**, ștergere cont **6.3**, GDPR/biometrie **12**.

---

## Cuprins

1. [Autentificare & sesiuni JWT](#1-autentificare--sesiuni-jwt)
2. [Login providers](#2-login-providers)
3. [Verificare facială / biometrie (TZ 2.2)](#3-verificare-facială--biometrie-tz-22)
4. [Protecția datelor personale](#4-protecția-datelor-personale)
5. [Hardening API](#5-hardening-api)
6. [Guardul de producție](#6-guardul-de-producție)

---

## 0. Ce e implementat vs. ce e planificat — pe scurt

| Zonă | Stare | Unde, în cod |
|---|---|---|
| JWT RS256, access 15 min stateless | ✅ | `app/core/security.py` |
| Refresh rotativ 30 zile + reuse detection pe familie | ✅ | `app/services/auth_service.py` |
| Refresh stocat ca **SHA-256 în PostgreSQL** | ✅ | `app/models/session.py` |
| Parole Argon2 | ✅ | `app/core/security.py` (passlib) |
| Rol + ban citite **din DB la fiecare cerere** | ✅ | `app/core/deps.py` |
| Rate limiting Redis (login/register/OTP/admin) | ✅ | `app/core/ratelimit.py` |
| Mascare contacte prin **regex** (nu NLP) | ✅ | `app/services/contact_masker.py` |
| Validare input (anti-XSS stocat, control chars, lungimi) | ✅ | `app/core/validators.py` |
| Upload: allowlist MIME + magic-bytes + 8 MB | ✅ | `app/api/v1/profiles.py` |
| Ștergere cont, grație 30 zile + purjare GDPR | ✅ | `app/services/account_service.py`, `scripts/gdpr_purge.py` |
| Guard de producție (18 verificări la pornire) | ✅ | `app/core/config.py` |
| TLS 1.2/1.3, HSTS, rate limit la margine | ✅ | `nginx/nginx.conf` |
| Logging JSON + `request_id` + handler global | ✅ | `app/core/logging.py`, `app/main.py` |
| Claim `age_group` / gardă `require_adult` | ❌ | **Nu există. Aplicația e 18+ only** — vezi 4.4 |
| Endpoint JWKS propriu (`/.well-known/jwks.json`), `kid`, rotație chei | 🔜 | cheile vin din env, fără `kid` |
| Denylist de `jti` de access în Redis | 🔜 | revocarea instantanee se face prin DB (vezi 1.6) |
| Criptare la nivel de câmp (KMS / envelope encryption) | 🔜 | doar criptare de volum, la nivel de infrastructură |
| Certificate pinning în app | 🔜 | — |
| Quantizarea distanței (anti-triangulare) | 🔜 | distanța se întoarce calculată haversine |
| Audit log complet de securitate (login/refresh/reuse) | 🔜 parțial | doar acțiunile de admin: `AdminAuditLog` |

---

## 1. Autentificare & sesiuni JWT

### 1.1 De ce două tokenuri (access + refresh)

| Token | Durată de viață | Rol | Unde circulă |
|-------|-----------------|-----|--------------|
| **Access token** | **15 min** (`ACCESS_TOKEN_EXPIRE_MINUTES`) | autorizează fiecare request (`Authorization: Bearer <access>`) | în fiecare request HTTP |
| **Refresh token** | **30 zile** (`REFRESH_TOKEN_EXPIRE_DAYS`), **rotativ** | obține un nou access token fără re-login | doar către `POST /auth/refresh` |

- **Access token-ul** e trimis la fiecare request, deci are suprafață mare de expunere (loguri, proxy-uri, memorie proces). Îl ținem **scurt** ca fereastra de abuz să fie mică. Este **stateless** — semnătura se validează fără lookup, deci scalează.
- **Refresh token-ul** circulă rar (doar la `/auth/refresh`), deci expunerea e mică; poate fi **lung** și **stateful** (îl urmărim în DB), ceea ce ne permite revocare și detecție de reutilizare.

> **Excepția importantă:** access token-ul e stateless ca *semnătură*, dar `get_current_user` **încarcă oricum userul din DB** la fiecare cerere. Vezi 1.6 — de asta nu avem nevoie de denylist de tokenuri pentru revocare instantanee.

### 1.2 Algoritm de semnare — RS256

Implementat în `app/core/security.py`, cu biblioteca **`python-jose`** (`from jose import jwt`), nu PyJWT.

- Cheile vin **din configurare** (`JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` în env, PEM cu `\n` literal permis — normalizate de un validator Pydantic). Zero chei hardcodate în cod.
- Cheia privată semnează, cheia publică verifică. Cu HS256 (secret simetric) orice serviciu care validează tokenuri ar putea și forja tokenuri; RS256 elimină riscul.
- **Anti `alg=none` / algorithm confusion:** la decodare fixăm explicit algoritmul:
  ```python
  jwt.decode(token, cfg.jwt_public_key, algorithms=[cfg.jwt_algorithm])  # RS256
  ```
  Nu lăsăm niciodată biblioteca să deducă algoritmul din header-ul token-ului.
- În producție, guardul din `config.py` refuză pornirea dacă vreuna dintre chei e goală (secțiunea 6).

> 🔜 **Planificat:** endpoint **JWKS** (`/.well-known/jwks.json`) + `kid` în header pentru rotația cheilor fără downtime. **Nu există azi** — cheile sunt statice, dintr-o singură pereche în env. Rotația actuală înseamnă redeploy cu chei noi (și invalidarea sesiunilor existente).

### 1.3 Claims — exact cele emise de cod

**Access token** (`create_access_token`):

```json
{
  "sub": "3f0c8b6e-...-uuid",   // User.id (UUID)
  "iat": 1751800000,
  "exp": 1751800900,            // +15 min
  "jti": "5d8e1c...",           // uuid4().hex
  "type": "access"
}
```

**Refresh token** (`create_refresh_token`):

```json
{
  "sub": "3f0c8b6e-...-uuid",
  "iat": 1751800000,
  "exp": 1754392000,            // +30 zile
  "jti": "a71bf9...",           // uuid4().hex — cheia rândului din refresh_sessions
  "family_id": "3c2e...",       // familia, pentru reuse detection (1.5)
  "type": "refresh"
}
```

Atât. **Nu există** claim-urile `scope`, `role`, `verified`, `age_group`, `iss`, `aud`. E o decizie, nu o scăpare:

- **Rolul și banul NU sunt în token.** Se citesc **din DB la fiecare cerere** (`app/core/deps.py`). Dacă rolul era în JWT, retragerea drepturilor unui admin ar fi intrat în vigoare abia la expirarea token-ului — o fereastră de 15 minute în care un admin demis rămâne admin. Așa, revocarea e **instantanee**.
- **`age_group` nu există** — aplicația e **18+ only** (secțiunea 4.4).
- **`verified` nu e în token** — statusul verificării faciale stă pe `Profile` și se citește din DB.

Prețul e un `SELECT` pe `users` per cerere autentificată; l-am plătit conștient în schimbul revocării imediate.

### 1.4 Stocare pe mobil (React Native / Expo)

| Token | Stocare | Motiv |
|-------|---------|-------|
| **Access token** | **doar în memorie** (state în `AuthContext`) | Durată scurtă; nu ajunge niciodată pe disc. La kill/restart dispare — se reobține instant prin refresh. |
| **Refresh token** | **`expo-secure-store`** | Trebuie persistat 30 de zile, deci are nevoie de stocare securizată, hardware-backed. |

**De ce `SecureStore` și NU `AsyncStorage`:**

- **`AsyncStorage`** salvează în **text clar**, într-o bază necriptată (SQLite pe Android, fișiere pe iOS). Orice acces la file system (root/jailbreak, backup nesecurizat, malware) citește token-ul direct. **Nepotrivit pentru secrete.**
- **`SecureStore`** folosește enclavele OS-ului: iOS → **Keychain** (Secure Enclave), Android → **Keystore** (chei hardware-backed, AES). Refresh-ul e criptat at-rest și legat de dispozitiv.

### 1.5 Refresh token rotation + reuse detection — implementarea reală

Starea sesiunilor de refresh stă în **PostgreSQL**, tabela `refresh_sessions` (modelul `RefreshSession`, `app/models/session.py`):

| Coloană | Ce e |
|---|---|
| `user_id` | FK către `users` |
| `jti` | unic, indexat — `jti`-ul token-ului curent |
| `family_id` | comun tuturor rotațiilor aceleiași sesiuni |
| `token_hash` | **SHA-256 hex** al token-ului brut — token-ul brut **nu se stochează niciodată** |
| `expires_at` | expirarea sesiunii |
| `revoked` | `bool` — rotit, delogat sau revocat |

> **Redis NU ține sesiuni.** Redis e folosit pentru exact două lucruri: **rate limiting** (`app/core/ratelimit.py`, prefix `rl:`) și **store-ul OTP live** (`app/services/auth_providers.py`, prefix `otp:`). Nimic altceva. Nu există `SET refresh:{jti}`, nu există `SADD family:{id}`.

Fluxul din `auth_service.rotate_refresh` (`app/services/auth_service.py`):

1. `decode_token(...)` → semnătură + `exp` (`JWTError` → 401).
2. `type != "refresh"` → 401.
3. Lipsește `jti` / `family_id` / `sub` → 401.
4. Nu există rândul cu acel `jti` → 401.
5. **Rândul e deja `revoked` → REUSE.** Revocăm **întreaga familie** (`UPDATE refresh_sessions SET revoked=true WHERE family_id = ...`) și întoarcem 401. Atât victima cât și atacatorul sunt deconectați; utilizatorul legitim se re-loghează, token-ul furat devine inutil.
6. **Verificare defensivă de hash:** `token_hash != sha256(token_prezentat)` → tot revocare de familie + 401. (Prinde cazul în care cineva ar avea un `jti` valid dar un token diferit.)
7. `expires_at` trecut → 401 (dublă verificare peste `exp` din JWT).
8. **User banat → revocăm familia și 403.** Fără asta, un cont banat își putea prelungi accesul la nesfârșit rotind un refresh emis înainte de ban.
9. Altfel: `session.revoked = True`, emitem o pereche nouă **în aceeași familie**, commit.

```python
# fragment real din auth_service.rotate_refresh
if session.revoked:
    await _revoke_family(db, session.family_id)   # UPDATE ... SET revoked=true
    await db.commit()
    raise invalid                                  # 401
```

### 1.6 Logout / revocare / ban

- **Logout** (`POST /auth/logout`): marchează `revoked=True` pe sesiunea cu `jti`-ul dat. Idempotent și best-effort — un refresh invalid **nu** eșuează zgomotos (nu vrem ca un client cu token corupt să nu se poată deloga).
- **Ștergerea contului** (`account_service.request_account_deletion`): revocă **toate** sesiunile de refresh neexpirate ale userului + ascunde profilul (`profile_hidden=True`), imediat, înainte de perioada de grație.
- **Ban** (`admin_service.ban_user`): trei acțiuni în **aceeași tranzacție** —
  1. `banned_at` + motivul → login-ul e refuzat (`auth_service`), rotația refresh-ului e refuzată, orice cerere cu access token valid primește **403** (`deps.get_current_user` verifică `user.is_banned` în DB);
  2. **revocarea tuturor sesiunilor de refresh**;
  3. `profile_hidden=True` → profilul dispare din feed-ul celorlalți.

  Un ban care setează doar `banned_at` ar fi teatru de securitate — de asta cele trei acțiuni sunt inseparabile.

> **Revocarea e deja instantanee**, fără denylist de tokenuri: rolul și `banned_at` se citesc **din DB la fiecare cerere**. Access token-ul rămâne criptografic valid până la expirare, dar nu mai *trece*.
>
> 🔜 Nu există (și nu ne trebuie azi) un **denylist de `jti` de access în Redis**. Ar deveni interesant doar dacă am elimina lookup-ul de user din calea normală — un trade-off invers.
>
> 🔜 Nu există un ecran de **management al sesiunilor active** ("dispozitiv / ultima activitate / revocă") și nici `POST /auth/logout-all`. Datele există în `refresh_sessions`; lipsesc endpoint-ul și UI-ul.

### 1.7 Diagramă de flux (real)

```
┌─────────┐                                    ┌──────────────┐      ┌────────────┐
│ Mobile  │                                    │  FastAPI     │      │ PostgreSQL │
│ (Expo)  │                                    │              │      │            │
└────┬────┘                                    └──────┬───────┘      └─────┬──────┘
     │                                                │                    │
  ①  │  POST /auth/login {email, password}            │                    │
     │───────────────────────────────────────────────▶│ verify Argon2      │
     │                                                │ (dummy hash dacă   │
     │                                                │  userul nu există) │
     │                                                │ INSERT refresh_    │
     │                                                │  sessions (sha256) │
     │                                                │───────────────────▶│
     │   200 { access (15m), refresh (30d) }          │                    │
     │◀───────────────────────────────────────────────│                    │
  ②  │  access → memorie ; refresh → SecureStore      │                    │
     │                                                │                    │
  ③  │  GET /feed   Authorization: Bearer <access>    │                    │
     │───────────────────────────────────────────────▶│ decode RS256       │
     │                                                │ SELECT users       │
     │                                                │───────────────────▶│
     │                                                │ is_banned? → 403   │
     │   200 (date)                                   │                    │
     │◀───────────────────────────────────────────────│                    │
     │                                                │                    │
     │        ... după 15 min access expiră (401) ... │                    │
     │                                                │                    │
  ④  │  POST /auth/refresh { refresh_token }          │                    │
     │───────────────────────────────────────────────▶│ SELECT ... jti     │
     │                                                │ revoked? → REUSE:  │
     │                                                │   revocă FAMILIA   │
     │                                                │ altfel: revocă jti │
     │                                                │   + INSERT nou     │
     │   200 { access nou, refresh nou }              │                    │
     │◀───────────────────────────────────────────────│                    │
  ⑤  │  POST /auth/logout { refresh_token }           │ revoked = true     │
     │───────────────────────────────────────────────▶│───────────────────▶│
     │  SecureStore.delete(refresh); access = null    │                    │
```

### 1.8 Codul real (nu pseudo-cod)

```python
# app/core/security.py — parole
from passlib.context import CryptContext
_pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

def hash_password(p: str) -> str:  return _pwd_context.hash(p)
def verify_password(p: str, h: str) -> bool:  return _pwd_context.verify(p, h)

# app/core/security.py — JWT (python-jose, RS256, chei din settings)
from jose import jwt

def create_access_token(sub: str, extra: dict | None = None) -> str:
    now = _now()
    payload = {
        "sub": sub,
        "iat": now,
        "exp": now + timedelta(minutes=cfg.access_token_expire_minutes),
        "jti": uuid.uuid4().hex,
        "type": "access",
    }
    return jwt.encode(payload, cfg.jwt_private_key, algorithm=cfg.jwt_algorithm)

def decode_token(token: str) -> dict:
    # algoritm FIXAT — anti alg=none / RS256→HS256 confusion
    return jwt.decode(token, cfg.jwt_public_key, algorithms=[cfg.jwt_algorithm])

def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()  # stocarea refresh-ului
```

```python
# app/core/deps.py — principalul autentificat
async def get_current_user(token: ..., db: ...) -> User:
    try:
        payload = decode_token(token)
    except JWTError:
        raise _credentials_exc                 # 401

    if payload.get("type") != "access":        # strict "access", nu "refresh"
        raise _credentials_exc

    user = await db.get(User, uuid.UUID(str(payload["sub"])))
    if user is None:
        raise _credentials_exc

    # Ban citit din DB la FIECARE cerere → revocare instantanee.
    if user.is_banned:
        raise _banned_exc                      # 403 (nu 401: token-ul E valid)
    return user


async def require_admin(current_user: ... = Depends(get_current_user)) -> User:
    # Rolul vine din DB, NU dintr-un claim JWT.
    if current_user.role != ROLE_ADMIN:
        raise HTTPException(403, "Administrator privileges required")
    return current_user
```

`require_admin` se aplică **o singură dată, pe `include_router`** în `app/api/v1/admin/__init__.py`, nu rută cu rută: o rută de admin nouă e protejată **prin construcție**. Apărarea "ține minte să pui dependency-ul pe fiecare handler" funcționează exact până când cineva adaugă a 21-a rută într-o vineri seara. `tests/test_admin_security.py` verifică contractul pentru **fiecare** rută: fără token → 401, user obișnuit → 403, admin banat → 403, rol retras între două cereri → 403 imediat.

**Nu există `require_adult` și nici `require_verified`.**

---

## 2. Login providers

TZ 2.1 cere patru metode de intrare; toate converg către același model de tokenuri (secțiunea 1). Toate identitățile externe intră prin `auth_service.login_with_identity(email=...)`, care face **get-or-create** pe un email derivat determinist (`google_{sub}@ext.flirt`, `apple_{sub}@ext.flirt`, `phone_{cifre}@ext.flirt`) — refolosim modelul `User` fără să-l complicăm. Conturile externe primesc un hash de parolă aleator, imposibil de reprodus.

Un cont **banat** nu poate intra pe niciuna dintre rute — altfel „ștergi appul, intri cu Google" ar învia contul banat.

Fiecare integrare are două moduri, comandate de `SOCIAL_AUTH_MODE` / `OTP_MODE`: **`stub`** (dezvoltare/teste, acceptă tokenuri și coduri de test) și **`live`**. Guardul de producție **refuză pornirea** cu orice integrare rămasă pe `stub` (secțiunea 6).

### 2.1 Sign in with Apple — `POST /auth/apple`

`auth_providers.verify_apple(id_token)`: descarcă JWKS-ul Apple de la `https://appleid.apple.com/auth/keys`, alege cheia după `kid` din header, verifică semnătura, `iss` și `aud == APPLE_CLIENT_ID`, `exp`. Identificatorul stabil e `sub`-ul Apple, **nu** emailul (care poate fi relay privat `@privaterelay.appleid.com`). Nu stocăm niciodată parole pentru aceste conturi.

### 2.2 Google Sign-In — `POST /auth/google`

`auth_providers.verify_google(id_token)`: JWKS Google (`https://www.googleapis.com/oauth2/v3/certs`), aceeași procedură, `aud == GOOGLE_CLIENT_ID`. Identificatorul stabil e `sub`-ul Google.

### 2.3 Email + parolă — `POST /auth/register`, `POST /auth/login`

- **Argon2** prin passlib (`CryptContext(schemes=["argon2"])`). Argon2 include sarea automat; fiecare hash e unic chiar la parole identice. **Niciodată** MD5/SHA fără sare.
- **Anti-enumerare prin timing:** `authenticate()` rulează `verify_password` **MEREU** — pe hash-ul real dacă userul există, pe un **hash Argon2 dummy constant** dacă nu există. Timpul de răspuns nu dezvăluie existența contului, iar 401-ul are exact același text (`"Invalid email or password"`) în ambele cazuri.
- **Ordinea verificărilor contează:** banul și rolul se verifică **DUPĂ** parolă. Un 403 înaintea validării parolei ar fi un oracol: un atacator ar putea inventaria conturile de admin sau conturile banate **fără să știe nicio parolă**.
- Rate limit: **5 login-uri / IP / minut** (secțiunea 5.1).

> 🔜 **Nu sunt implementate:** resetarea parolei prin email (token single-use, TTL scurt), verificarea împotriva listelor de parole compromise (HaveIBeenPwned k-anonymity), `check_needs_rehash`.

### 2.4 Telefon + OTP — `POST /auth/phone/request`, `POST /auth/phone/verify`

- Cod **OTP de 6 cifre**; TTL din `OTP_TTL_SECONDS` (implicit **300 s**).
- În modul **live**, codurile stau în **Redis** (prefix `otp:`), împreună cu contorul de încercări (`otp_attempts:`) și contorul de cereri (`otp_req:`). În **stub**, într-un store in-memory, iar codul acceptat e `OTP_TEST_CODE`.
- **Anti brute-force:** max **5 încercări de verificare per cod** (`OTP_MAX_ATTEMPTS`), apoi codul e invalidat. Peste 6 cifre, fără plafon, un cod s-ar sparge trivial.
- **Anti-abuz / anti-cost SMS:** max **5 cereri OTP / oră** (`OTP_REQUEST_PER_HOUR`), atât per telefon (în `auth_providers`, fereastră de o oră) cât și per IP (rate limit pe rută). Cererile de cod costă bani reali — un atacator care le trimite în buclă ne golește bugetul, nu doar ne enervează.
- Verificare la depășire: **429**.
- SMS live prin **Twilio** (REST peste HTTP; `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM`).

> 🔜 **Nu e implementată** protecția anti **SIM-swap** (re-verificare + revocarea tuturor sesiunilor la schimbarea numărului).

---

## 3. Verificare facială / biometrie (TZ 2.2)

Biometria e cea mai sensibilă categorie de date (**date de categorie specială**, GDPR Art. 9). Ce e implementat azi:

### 3.1 Ce există

`app/services/face_verify.py` — o fabrică de verificatoare, aleasă prin `FACE_VERIFY_PROVIDER`:

- **`stub`** — implicit, pentru dezvoltare/teste.
- **`rekognition`** — **AWS Rekognition `CompareFaces`**: compară selfie-ul cu prima poză de referință din anketă. `verified = SimilarityScore ≥ FACE_MATCH_THRESHOLD` (implicit **90.0**).

Rezultatul e un **flag `verified` pe `Profile`** + scorul. Guardul de producție refuză pornirea cu `FACE_VERIFY_PROVIDER=stub` sau cu `rekognition` fără chei AWS.

### 3.2 Ce NU există (🔜)

Documentul anterior descria un sistem complet de verificare biometrică. Nu a fost construit. Concret, **nu există**:

- 🔜 **Liveness check** cu provocări active randomizate server-side (întoarce capul, clipește). Fără el, o **fotografie a unei fotografii** trece verificarea. Aceasta e cea mai importantă gaură rămasă din TZ 2.2.
- 🔜 **Store dedicat, izolat** pentru template-uri biometrice (bucket/tabelă separată, chei de acces distincte). Nu stocăm template-uri deloc — trimitem imaginile la Rekognition și păstrăm doar scorul + flag-ul. Din perspectiva minimizării datelor asta e, de fapt, **bine**.
- 🔜 **Criptare envelope cu KMS** (DEK/KEK) pentru artefacte biometrice.
- 🔜 **Ecran de consimțământ explicit** (GDPR Art. 9(2)(a)) înainte de captură, cu consimțământul logat.
- 🔜 **Cale de contestație / revizuire manuală** a unui eșec de verificare (aliniere GDPR Art. 22).

### 3.3 Ce rămâne valabil ca principiu

- **Minimizare:** selfie-ul se procesează și **nu se stochează** în storage-ul de profile. Păstrăm doar rezultatul (scor, pass/fail).
- **Fotografiile de profil** (non-biometrice ca scop) stau în storage-ul obișnuit (S3 privat sau stub local; allowlist MIME + magic-bytes + max 8 MB — vezi 5.6).
- **Ștergerea contului** duce la ștergerea profilului și a referințelor la poze (4.5).
- **Localizarea datelor** și termenele de retenție biometrică rămân de confirmat cu clientul (TZ 12).

---

## 4. Protecția datelor personale

### 4.1 Criptare at-rest — stare reală

- ✅ **Criptare de volum / disc** — asigurată la nivel de infrastructură (volumele Docker / discul serverului). Aceasta e baza minimă și e singura care există.
- ✅ **Secrete** (chei JWT, credențiale DB, chei API) — **doar** în `.env` (injectat ca variabile de mediu), niciodată în cod, niciodată commit-uite. `.gitignore` include `.env`. `entrypoint.sh` refuză pornirea dacă a rămas vreo valoare `<<< COMPLETEAZĂ >>>`.
- 🔜 **Criptare la nivel de câmp (envelope encryption cu KMS)** pentru coordonate exacte, telefon, email, conținutul mesajelor — **NU e implementată**. Un dump al bazei de date expune aceste câmpuri în clar. Este cel mai important element rămas din această secțiune.
- 🔜 **Secret manager** dedicat (AWS Secrets Manager / Vault) în locul `.env` — planificat.

### 4.2 Niciodată adresa exactă — doar distanță (TZ 7)

- Orașul (+ opțional strada) se **geocodează** în `lat`/`lng` prin `app/services/geo.py`. Provider implicit recomandat: **Nominatim (OpenStreetMap)** — gratuit, **fără cheie API**, cere doar un `User-Agent` identificabil (politica OSM; guardul de producție respinge `GEO_USER_AGENT` implicit cu `example.com`). Alternative: `google`, `mapbox` (cer `GEO_API_KEY`).
- `lat`/`lng` sunt coloane **`Float`** pe `Profile` (`ix_profiles_lat_lng`). **Nu folosim PostGIS.**
- Filtrarea pe rază se face în două trepte: un **bounding box** în SQL (folosește indexul; un `WHERE` pe haversine nu ar putea) urmat de **haversine exact** în Python (`geo.haversine_km`). Bounding box-ul e generos prin construcție — nu poate elimina din greșeală un candidat valid.
- API-ul întoarce **doar distanța** (`distance_km`), niciodată coordonatele altui user.

> 🔜 **Quantizarea distanței** (rotunjire la trepte de 1 km, snapping la centrul unei grile) — **recomandată, neimplementată**. Fără ea, un atacator care măsoară distanța din trei locații diferite poate reconstrui poziția prin trilaterare. E o mitigare ieftină pe care merită să o adăugăm.

### 4.3 Mascare contacte în chat (TZ 5.5)

**`app/services/contact_masker.py`** — `mask_contacts(text) -> (text_mascat, s_a_mascat_ceva)`, funcție **pură**, aplicată **server-side la trimiterea mesajului**. Mesajul stocat ȘI cel livrat conțin deja versiunea mascată; nu ne bazăm pe client.

**Este un set de regex-uri, NU un model NLP.** Documentul anterior spunea „modul NLP" — era fals. Ce detectează, în ordine (specificul înaintea genericului, ca să nu producem mascări parțiale):

| # | Tipar | Exemplu |
|---|---|---|
| 1 | `EMAIL_RE` — email | `ion@gmail.com` → `****` |
| 2 | `URL_RE` — URL cu schemă sau `www.` | `https://t.me/ion` → `****` |
| 3 | `BARE_DOMAIN_RE` — domenii fără schemă, pe TLD-uri uzuale | `t.me/ion` → `****` |
| 4 | `MESSENGER_MENTION_RE` — cuvânt-cheie + nick | `telegram @ion_98` → `telegram ****` (cuvântul-cheie rămâne, ca în TZ) |
| 5 | `HANDLE_RE` — handle social generic `@nume` | `@ion_98` → `****` |
| 6 | `PHONE_CANDIDATE_RE` — telefon, validat pe **≥ 7 cifre reale** | `+40 712 345 678` → `****` |

Pragul de 7 cifre există ca să nu mascăm ani, prețuri sau numere scurte.

> **Limita onestă a abordării:** regex-urile **nu prind ofuscările** („t e l e g r a m", „ion arond gmail punct com", cifre scrise în litere). Un utilizator hotărât trece de ele. Un model NLP ar prinde mai mult — 🔜, nu e construit.

### 4.4 Vârstă: aplicația e 18+ ONLY — TZ 2.3 e OBSOLET

> ⚠️ **Secțiunea „Minor safety 16–17" a fost ȘTEARSĂ. Nu a fost mutată, nu a fost amânată — a fost eliminată, împreună cu tot segmentul 16–17.**

**DE CE:** politicile **App Store** și **Google Play** interzic aplicațiilor de dating accesul minorilor. Un produs cu un segment 16–17 **nu trece review-ul**, indiferent cât de bine e izolat tehnic. Cerința TZ 2.3 (feed-uri separate pe grupe de vârstă, praguri de moderare diferențiate) e **incompatibilă cu publicarea în magazine** și a fost abandonată ca decizie de produs.

**CE ÎNSEAMNĂ ÎN COD:**

- ❌ **Nu există claim-ul `age_group`** (`"16_17"` / `"18plus"`) în niciun token.
- ❌ **Nu există garda `require_adult`**. Nu e nevoie de ea: **fiecare** utilizator autentificat e adult, prin construcție.
- ✅ **Prag legal unic:** `ADULT_AGE = 18`, `MIN_REGISTRATION_AGE = 18`.
- ✅ **`_guard_adult_only`** (`app/core/config.py`) — un validator Pydantic care rulează în **ORICE mediu**, nu doar în producție: dacă `min_registration_age < adult_age`, aplicația **nu pornește** (`ValueError`). O configurare greșită (`MIN_REGISTRATION_AGE=16`) nu poate readuce minorii în aplicație nici din greșeală, nici pe un server de test uitat pornit.
- ✅ **`search_age_min_default`** e **ridicat automat** la `adult_age`. Nu se poate căuta sub pragul legal.
- ✅ **Pragul bate orice preferință salvată:** în `account_service._effective_preferences`, `age_min = max(age_min, settings.adult_age)`. Nici măcar o linie coruptă din DB nu poate produce un feed cu minori.
- ✅ `PUT /settings` întoarce **422** la orice `age_min` sub 18.

Apărarea e în **trei straturi independente** (config, preferințe efective, validare API) pentru că o singură verificare care poate fi ocolită printr-un `UPDATE` manual în DB nu e o apărare.

### 4.5 Ștergere cont cu perioadă de grație (TZ 6.3)

**Cerere** (`POST /api/v1/settings/account/delete` → `account_service.request_account_deletion`), trei efecte **imediate**:

1. Se creează `AccountDeletionRequest` cu `purge_after = now + ACCOUNT_DELETION_GRACE_DAYS` (implicit **30 de zile**).
2. **Toate sesiunile de refresh** neexpirate → `revoked=True` (logout global).
3. `profile_hidden=True` → profilul dispare din feed **acum**, nu peste 30 de zile.

Utilizatorul poate anula în perioada de grație (`POST /api/v1/settings/account/delete/cancel`).

**Purjarea** (`account_service.purge_expired_accounts` → `purge_user_data`) rulează într-un **serviciu Docker Compose separat** (`purge`, care execută `scripts/gdpr_purge.py --loop`, interval `GDPR_PURGE_INTERVAL_SECONDS`), **NU în lifespan-ul FastAPI**. Motivul e concret: `entrypoint.sh` pornește **4 workeri gunicorn**, deci un task în lifespan ar rula **de 4 ori în paralel**, pe aceleași rânduri.

Ce se șterge efectiv (`purge_user_data`, idempotentă, apelată identic și de `admin_service.delete_user`):

`Message` · `Chat` · `Profile` · `Story` · `Like` · `Match` · `Favorite` · `Block` · `UserSettings` · `RefreshSession` · **`PushDevice`** · `Ticket` · `EventAttendance` · `FlirtPassportStamp` · `Subscription`

Două decizii care merită explicate:

- **Rândul din `users` NU se șterge — se ANONIMIZEAZĂ.** `email` devine `deleted+{uuid}@deleted.invalid` (domeniul `.invalid`, RFC 2606, nu poate fi înregistrat vreodată), `password_hash` devine șirul gol (niciun hash nu se potrivește ⇒ nicio parolă nu funcționează), `profile_completed=False`. Contul devine ne-autentificabil și ne-identificabil, dar cheile externe rămân valide.
- **Rapoartele de moderare (`Report`) se PĂSTREAZĂ — intenționat.** GDPR **art. 17(3)** permite păstrarea datelor necesare pentru constatarea sau apărarea unui drept și pentru prevenirea abuzului. Dacă am fi șters rapoartele odată cu contul, un abuzator și-ar fi putut curăța dovezile pur și simplu cerându-și ștergerea contului — și ar fi revenit cu un cont nou și un istoric de moderare gol. Exact de asta rândul `users` rămâne (anonimizat): ca FK-urile rapoartelor să nu se rupă.

> 🔜 **Propagarea ștergerii în backup-uri** nu e documentată cu un termen maxim. Serviciul `backup` din Compose face dump-uri periodice; politica de retenție și procedura de purjare din backup **trebuie scrise** (cerință GDPR).

### 4.6 Audit logging

**Ce există:** `AdminAuditLog` (`app/models/admin.py`) — jurnal **append-only** al acțiunilor din panoul de admin: cine (admin), ce (ban / unban / ștergere / acordare abonament / moderare), pe cine, **de la ce IP** (determinat cu aceeași funcție `ratelimit.client_ip` folosită la rate-limiting — o a doua implementare ar diverge exact în scenariul care contează, în spatele reverse-proxy-ului). Expus la `GET /api/v1/admin/audit`.

**Ce există parțial:** logging JSON structurat pe fiecare cerere (secțiunea 5.7) — `request_id`, metodă, cale, status, durată. **Fără PII, fără tokenuri, fără body-uri.**

> 🔜 **Nu există un audit log de securitate dedicat** pentru: login (succes/eșec), refresh, **reuse detection** (!), logout, consimțământ biometric, rezultatul verificării faciale, cereri de ștergere și purjări. `reuse_detected` în special ar trebui să fie un eveniment alarmabil — azi e doar un 401 în access log.

---

## 5. Hardening API

### 5.1 Rate limiting — implementarea reală

**`app/core/ratelimit.py`.** Backend **Redis**, fereastră **fixă**: `INCR` + `EXPIRE` trimise în **pipeline cu `transaction=True`** (MULTI/EXEC). Cheia conține indexul ferestrei (`floor(now / window)`), deci expiră singură și nu trebuie curățată.

De ce MULTI/EXEC și nu două comenzi separate: o cădere între `INCR` și `EXPIRE` ar lăsa o cheie **fără TTL** — adică un IP blocat **pentru totdeauna**.

**Limitele efective, toate din `settings` (zero hardcodare):**

| Endpoint | Limită | Setting | Bucket |
|---|---|---|---|
| `POST /auth/login` | **5 / minut / IP** | `RATE_LIMIT_LOGIN_PER_MIN` | `login` |
| `POST /auth/register` | **10 / oră / IP** | `RATE_LIMIT_REGISTER_PER_HOUR` | `register` |
| `POST /auth/phone/request` | **5 / oră / IP** | `OTP_REQUEST_PER_HOUR` | `otp_request` |
| `POST /auth/phone/verify` | **5 / minut / IP** | `RATE_LIMIT_LOGIN_PER_MIN` | `otp_verify` |
| `POST /admin/login` | **3 / minut / IP** | `RATE_LIMIT_ADMIN_LOGIN_PER_MIN` | `admin_login` |

Depășire → **429**. `admin_login` are **bucket separat** de `login`: un cont de admin spart = tot produsul spart, iar numărul de admini e mic, deci un prag mai strict nu deranjează pe nimeni legitim. Dacă ar fi împărțit bucket-ul cu login-ul obișnuit, traficul normal ar fi consumat cota adminului.

**IP-ul clientului** se determină din `X-Forwarded-For` (primul din listă; nginx îl setează), cu fallback pe `request.client.host`.

**Fallback in-memory:** dacă `REDIS_URL` lipsește (dev, teste) sau Redis cade, cădem pe un limitator sliding-window in-memory și **logăm warning**. E fail-open către store-ul local, nu fail-closed: un Redis căzut nu are voie să blocheze login-ul tuturor userilor — dar nici nu lăsăm limitarea la zero.

> ⚠️ **De asta `REDIS_URL` e OBLIGATORIU în producție** (guardul îl impune, secțiunea 6): limitatorul in-memory e **per proces**, iar `entrypoint.sh` pornește **4 workeri gunicorn** ⇒ limita reală devine **4×** cea configurată, și se înmulțește la scale-out orizontal. Practic, brute-force-ul pe login trece.

**La margine (nginx, `nginx/nginx.conf`):**

```nginx
limit_req_zone $binary_remote_addr zone=flirt_general:10m rate=20r/s;
limit_req_zone $binary_remote_addr zone=flirt_auth:10m    rate=5r/m;
```
`flirt_auth` (burst 10) pe rutele de auth, `flirt_general` (burst 40) pe restul. Două straturi: nginx oprește inundațiile brute înainte să atingă Python, aplicația aplică limitele semantice.

> 🔜 **Nu există** rate limiting **per user** (`sub`) — doar per IP. Un atacator cu multe IP-uri (botnet, proxy rotativ) nu e oprit de limita per-IP.
> 🔜 **Nu trimitem header-ul `Retry-After`** pe 429.

### 5.2 HTTPS / TLS

`nginx/nginx.conf` + `certbot` (Let's Encrypt, serviciu în Compose):

- ✅ **TLS 1.2 / 1.3** (`ssl_protocols TLSv1.2 TLSv1.3;`). HTTP → redirecționat.
- ✅ **HSTS:** `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.
- ✅ Uvicorn pornește cu `--forwarded-allow-ips`, ca `X-Forwarded-Proto` să fie respectat (altfel ar considera cererile HTTP chiar venind prin TLS).

> 🔜 **Certificate pinning** în aplicația mobilă — **recomandat, neimplementat**. Ar reduce riscul de MITM pe endpoint-urile de auth, cu prețul unei operațiuni de rotație a certificatului mai delicate.

### 5.3 CORS

- Configurat din `CORS_ORIGINS` (allow-list explicită, `app/main.py`).
- **Guardul de producție respinge `*`** în `CORS_ORIGINS` (secțiunea 6). Nu combinăm niciodată wildcard cu `allow_credentials`.
- `expose_headers` include `X-Request-ID` și **`X-Next-Cursor`** — fără el, un client web nu poate citi cursorul de paginare din header (pe mobil politica CORS nu se aplică, de asta lipsa a trecut neobservată o vreme).

### 5.4 Moderare & ban (TZ 5.5 / 10)

**Raportări** (`app/services/moderation_service.py`): la **`REPORT_AUTOBAN_THRESHOLD` raportori DISTINCȚI** (implicit **3**) împotriva aceluiași user, se declanșează `_auto_ban`.

> ⚠️ **Numele funcției minte.** `_auto_ban` **NU banează**: setează doar `profile_hidden=True` (auto-**ascundere**). **Nu** setează `banned_at`, deci **contul se poate încă loga**, iar sesiunile **nu** sunt revocate.
>
> Asta e o **decizie deliberată**, nu un bug: 3 raportori pot fi 3 conturi coordonate care vor să scoată pe cineva din aplicație. Ascunderea e o măsură de **urgență reversibilă** (oprește expunerea imediat); **decizia de ban aparține unui om**, din panoul de admin. Un auto-ban complet ar transforma brigading-ul într-o armă.

**Ban-ul real** (`admin_service.ban_user`) e cel din secțiunea 1.6: `banned_at` + revocarea sesiunilor + `profile_hidden`, în aceeași tranzacție, cu intrare în `AdminAuditLog`.

> 🔜 **Nu există:** bază de conținut interzis (hash-matching), scoring comportamental, coadă de moderare cu priorități, cale formală de contestație.

### 5.5 Protecție împotriva enumerării

- ✅ **Login:** răspuns identic (401, același text) și **timp de răspuns uniform** — `verify_password` rulează mereu, pe hash-ul dummy când userul nu există (2.3).
- ✅ **Ban și rol verificate DUPĂ parolă** — altfel ar fi oracole („acest email există și e banat", „acest email e de admin") oferite cuiva care nu știe nicio parolă.
- ✅ **ID-uri neenumerabile:** toți identificatorii publici sunt **UUID**, nu întregi secvențiali.
- ✅ Rate limiting pe toate rutele care s-ar preta la enumerare (5.1).
- ⚠️ **`POST /auth/register` întoarce 409 „Email already registered".** Este, tehnic, un oracol de enumerare: îți spune dacă un email are deja cont. Alternativa (confirmare pe email, răspuns identic în ambele cazuri) presupune un flux de email pe care nu îl avem încă. 🔜

### 5.6 Validare input & upload

**`app/core/validators.py`** — aplicat pe **toate** schemele Pydantic:

- `safe_str(max_length)` / `optional_safe_str(max_length)`: **trim** automat, **non-gol**, **plafon de lungime**, respinge **caractere de control** (`\x00-\x08`, `\x0b`, `\x0c`, `\x0e-\x1f`, `\x7f`) și orice **marcaj HTML** (`<[^>]*>`) — prevenire XSS **stocat**, servit ulterior în alt context (panoul de admin web, notificări).
- `is_https_url`: allowlist de schemă (doar `https://`), validat suplimentar față de domeniul din `STORAGE_BASE_URL`.

**SQL injection:** **zero** SQL brut în tot backend-ul. 100% SQLAlchemy ORM, parametrizat prin construcție.

**Upload de imagini** (`app/api/v1/profiles.py`, `_validate_image_upload`), trei bariere:

1. **Dimensiune** > `MAX_UPLOAD_BYTES` (**8 MB**) → **413**.
2. **Content-type declarat** absent din allowlist (`ALLOWED_IMAGE_TYPES`: `image/jpeg`, `image/png`, `image/webp`) → **422**.
3. **Magic-bytes** — tipul **real** al fișierului e detectat din primii octeți, **nu** din header-ul HTTP (pe care clientul îl controlează complet) și trebuie să corespundă allowlist-ului → **422**. Fără această a treia barieră, un `.php` sau un binar cu `Content-Type: image/jpeg` ar trece.

**Anti mass-assignment:** scheme separate pentru input și output; `role`, `banned_at`, `verified`, `id` **nu** pot fi setate din request.

**Anti-DoS pe colecții:** toate listele sunt paginate cu **cursor** și cu plafon de `limit` din config (`*_MAX_LIMIT`) — inclusiv în panoul de admin (un admin nu are voie să ceară „toate cele 2 milioane de rânduri"; ar fi un DoS declanșat din interior).

> 🔜 **Nu există** scanare antivirus / de conținut a media încărcate (poze indecente, CSAM). Pentru un produs de dating publicat în magazine, aceasta e o lipsă serioasă.

### 5.7 Observabilitate (`app/core/logging.py`, `app/main.py`)

- ✅ **Logging JSON structurat** (`LOG_FORMAT=json`; `text` doar pentru dev local).
- ✅ **`request_id`** pe fiecare cerere (`RequestContextMiddleware`), returnat în header-ul **`X-Request-ID`** și prezent în **toate** log-urile cererii (inclusiv stack trace-uri) → corelare completă.
- ✅ **Access log** propriu (`AccessLogMiddleware`): metodă, cale, status, durată. **Fără PII, fără tokenuri, fără body-uri.** Access log-ul gunicorn e oprit intenționat — două log-uri de acces în formate diferite = zgomot și dublă stocare.
- ✅ **Handler global de excepții** (`app/main.py`): orice excepție neprinsă e logată **complet** (stack trace) pe server, iar clientul primește un răspuns **generic** (`{"detail": "Internal server error", "request_id": ...}`). Fără el, o eroare internă poate scurge căi de fișiere, SQL sau chiar DSN-ul cu parolă direct în răspunsul HTTP. Singurul lucru pe care îl dăm înapoi e `request_id`-ul: userul îl raportează la suport, noi găsim exact cererea.

---

## 6. Guardul de producție

`_guard_production` (`app/core/config.py`) — un validator Pydantic care rulează **doar când `ENVIRONMENT=production`**. Adună **toate** problemele (nu se oprește la prima) și ridică un singur `ValueError` cu lista completă: dacă ai trei lucruri de reparat, le afli pe toate din prima pornire, nu una pe rundă.

**Cele 18 verificări:**

| # | Verificare | De ce |
|---|---|---|
| 1 | Orice valoare care conține **`COMPLETEAZ`** | `.env.production.example` marchează câmpurile cu `<<< COMPLETEAZĂ >>>`. Acela e un șir **nevid**, deci trecea de toate verificările „e gol?": stack-ul pornea aparent sănătos și crăpa abia la primul login (PEM invalid). `entrypoint.sh` verifică același lucru, mai devreme. |
| 2 | `POSTGRES_PASSWORD == "change_me"` | parola implicită din repo |
| 3 | `DATABASE_URL` gol **și** fără parolă Postgres | |
| 4 | `JWT_PRIVATE_KEY` gol | |
| 5 | `JWT_PUBLIC_KEY` gol | |
| 6–12 | **Orice integrare rămasă pe `stub`**: `SOCIAL_AUTH_MODE`, `OTP_MODE`, `BILLING_PROVIDER`, `FACE_VERIFY_PROVIDER`, `STORAGE_PROVIDER`, `PUSH_PROVIDER`, **`GEO_PROVIDER`** | stub = verificări **false** (social login care acceptă orice token, OTP cu cod fix, plăți care „reușesc" mereu, KYC facial care aprobă orice). **`GEO_PROVIDER` lipsea din listă**: producția putea porni **tăcut** cu geocoderul stub (~20 de orașe hardcodate), iar orice alt oraș primea `distance_km = None` ⇒ raza de căutare și factorul de distanță din Compatibility Score deveneau **inoperante, fără nicio eroare**. |
| 13 | `STORAGE_PROVIDER=s3` fără `S3_BUCKET` / `S3_REGION` / chei AWS | modul „live fără chei" e mai rău decât stub-ul: eșuează **mai târziu și mai urât** — la primul upload, în producție, pe utilizatori reali |
| 14 | `FACE_VERIFY_PROVIDER=rekognition` fără chei AWS | idem |
| 15 | `SOCIAL_AUTH_MODE=live` fără **niciun** `GOOGLE_CLIENT_ID` / `APPLE_CLIENT_ID` | butoanele „Continuă cu Google/Apple" ar duce într-un zid |
| 16 | **`REDIS_URL` gol — eroare MEREU în producție**, indiferent de OTP | fără el, rate-limiting-ul cade **tăcut** pe in-memory; cu 4 workeri gunicorn limita reală devine **4×** cea configurată, iar la scale-out se înmulțește. Adică protecția anti-brute-force **nu există**. |
| 17 | `OTP_MODE=live` fără Twilio; `BILLING_PROVIDER=stripe` fără `STRIPE_SECRET_KEY`; `=app_store` fără `APP_STORE_SHARED_SECRET`; `PUSH_PROVIDER=fcm` fără `FCM_SERVER_KEY`; `GEO_PROVIDER=google\|mapbox` fără `GEO_API_KEY`; `GEO_PROVIDER=nominatim` cu `GEO_USER_AGENT` implicit (`example.com`) | chei lipsă pentru providerul **efectiv ales**. Nominatim cu User-Agent implicit → **OSM blochează** (politica lor). |
| 18 | `DEBUG=true`; `CORS_ORIGINS` conține `*` | debug expune stack trace-uri; wildcard CORS + credențiale = expunere |

**Plus `_guard_adult_only`** — care rulează în **ORICE mediu**, nu doar în producție (vezi 4.4): `min_registration_age < adult_age` → `ValueError` la pornire.

Testat în `backend/tests/test_config.py`.

---

## Rezumat rapid al deciziilor cheie

- **Două tokenuri:** access JWT **15 min** (RS256, `python-jose`, în memorie pe mobil) + refresh **rotativ 30 zile** (în `expo-secure-store`).
- **Sesiunile de refresh stau în PostgreSQL** (`refresh_sessions`), ca **SHA-256** — niciodată token-ul brut. **Redis e doar pentru rate-limiting și OTP.**
- **Refresh rotation + reuse detection** cu revocare pe **întreaga familie** (`family_id`).
- **Rolul și banul se citesc din DB la fiecare cerere**, NU din JWT → **revocare instantanee**, fără denylist de tokenuri.
- **Parole Argon2** + **hash dummy** la login pentru timing uniform (anti-enumerare).
- **18+ ONLY.** Fără `age_group`, fără `require_adult`. TZ 2.3 (segmentul 16–17) e **obsolet** — App Store / Google Play îl interzic. Pragul e apărat în **trei straturi**, unul dintre ele activ în orice mediu.
- **Mascare contacte prin REGEX server-side** (nu NLP) — și cu limitele ei (ofuscările trec).
- **Rate limiting Redis** (login 5/min, register 10/h, OTP 5/h, admin login 3/min) + nginx la margine. **`REDIS_URL` obligatoriu în producție.**
- **Ștergere cont: 30 zile grație**, apoi purjare într-un **serviciu separat** (nu în lifespan — 4 workeri). `users` se **anonimizează**, rapoartele de moderare se **păstrează** (art. 17(3)).
- **Auto-moderarea ASCUNDE, nu banează.** Banul e o decizie umană, din panoul de admin.
- **Guard de producție cu 18 verificări** — refuză să pornească cu o configurare nesigură.
- **Rămân de făcut (🔜):** liveness check, criptare la nivel de câmp (KMS), audit log de securitate (mai ales `reuse_detected`), quantizarea distanței, certificate pinning, scanare de conținut la upload, reset parolă, management sesiuni active.
