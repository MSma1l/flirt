# Securitate — Backend FLIRT ("No Regrets")

> Documentație de securitate pentru backend-ul FastAPI al aplicației FLIRT.
> Textul explicativ este în română; numele de câmpuri, claim-urile JWT, codul și identificatorii sunt în engleză.
>
> Documente conexe (nu se editează din acest document):
> - [`docs/backend/README.md`](./README.md) — arhitectură generală backend, stack, servicii.
> - [`docs/backend/data-models.md`](./data-models.md) — modele de date, în special entitatea **`Session`** (referită mai jos).
>
> Referințe la Termenii de Referință (TZ): verificare identitate **2.2**, restricții de vârstă **2.3**, mascare contacte **5.5**, moderare **10**, geolocație **7**, ștergere cont **6.3**, date personale/GDPR/biometrie **12**.

---

## Cuprins

1. [Autentificare & sesiuni JWT](#1-autentificare--sesiuni-jwt)
2. [Login providers](#2-login-providers)
3. [Verificare facială / biometrie (TZ 2.2)](#3-verificare-facială--biometrie-tz-22)
4. [Protecția datelor personale](#4-protecția-datelor-personale)
5. [Hardening API](#5-hardening-api)

---

## 1. Autentificare & sesiuni JWT

### 1.1 De ce două tokenuri (access + refresh)

Folosim un model cu **două tokenuri separate**, deoarece cerințele de securitate ale celor două sunt în conflict:

| Token | Durată de viață | Rol | Unde circulă |
|-------|-----------------|-----|--------------|
| **Access token** | scurtă — **15 min** | autorizează fiecare request către API (`Authorization: Bearer <access>`) | în fiecare request HTTP |
| **Refresh token** | lungă — **~30 zile**, **rotativ** | obține un nou access token fără re-login | doar către endpoint-ul `/auth/refresh` |

Ideea de bază:

- **Access token-ul** e trimis la fiecare request, deci are suprafață mare de expunere (loguri, proxy-uri, memorie proces). Îl ținem **scurt** (15 min) astfel încât, chiar dacă e furat, fereastra de abuz să fie mică. Access token-ul este **stateless** — serverul îl validează doar prin semnătură, fără lookup în DB, deci scalează.
- **Refresh token-ul** circulă rar (doar la `/auth/refresh`), deci expunerea e mică; poate fi **lung** și **stateful** (îl urmărim în Redis), ceea ce ne permite revocare și detecție de reutilizare.

Astfel obținem simultan: performanță (validare stateless a access-ului) **și** control (revocare pe refresh).

### 1.2 Algoritm de semnare — RS256 (recomandat)

Folosim **RS256** (RSA + SHA-256, semnătură asimetrică), nu HS256:

- **Cheia privată** semnează tokenurile — o deține doar serviciul de autentificare (auth service).
- **Cheia publică** verifică semnătura — poate fi distribuită liber tuturor microserviciilor / gateway-urilor care validează tokenuri, fără riscul ca acestea să poată emite tokenuri noi.
- Cu HS256 (secret simetric) orice serviciu care validează tokenuri ar avea și puterea de a le forja. RS256 elimină acest risc.
- Cheia publică este expusă printr-un endpoint **JWKS** (`/.well-known/jwks.json`), cu `kid` (key ID) în header-ul JWT, ceea ce permite **rotația cheilor** fără downtime.

> Notă anti-`alg=none`: la validare fixăm explicit `algorithms=["RS256"]`. Nu acceptăm niciodată `none` și nu lăsăm biblioteca să deducă algoritmul din header-ul token-ului (atac clasic de algorithm confusion RS256→HS256).

### 1.3 Claims

**Access token — payload exemplu:**

```json
{
  "sub": "usr_9f3a2b7c",        // user ID (subiectul)
  "iss": "https://api.flirt.app",
  "aud": "flirt-mobile",
  "iat": 1751800000,            // issued at
  "exp": 1751800900,            // expiră la +15 min
  "jti": "at_5d8e1c...",        // JWT ID unic (pentru trasabilitate)
  "scope": "user",              // role/scope: user | moderator | admin
  "age_group": "18plus",        // "16_17" | "18plus" — vezi TZ 2.3
  "verified": true,             // status verificare facială (TZ 2.2)
  "token_type": "access"
}
```

**Refresh token — payload exemplu:**

```json
{
  "sub": "usr_9f3a2b7c",
  "iat": 1751800000,
  "exp": 1754392000,            // +30 zile
  "jti": "rt_a71bf9...",        // ID unic al acestui refresh token
  "family": "fam_3c2e...",      // ID familie (pentru reuse detection, 1.5)
  "token_type": "refresh"
}
```

Semnificația claim-urilor importante:

- **`sub`** — identificatorul stabil al utilizatorului.
- **`exp` / `iat`** — expirare / moment emitere (validate mereu; `exp` obligatoriu).
- **`jti`** — ID unic al tokenului; pentru refresh e cheia de urmărire în Redis, pentru access e util în audit log.
- **`scope` / role** — nivelul de autorizare (`user`, `moderator`, `admin`).
- **`age_group`** — `"16_17"` sau `"18plus"`. **Critic** pentru izolarea vârstelor (TZ 2.3): minorii văd doar profile 16–17, nu au acces la conținut/rute 18+. Se pune în token la login pe baza datei de naștere și **nu poate fi modificat de client**.
- **`verified`** — dacă profilul a trecut verificarea facială (TZ 2.2); influențează vizibilitatea și accesul la anumite acțiuni.

> `age_group` derivă din data nașterii, dar tranziția 17→18 se recalculează server-side la fiecare login/refresh — un token vechi cu `"16_17"` expiră în max 15 min, deci nu blochează utilizatorul devenit major.

### 1.4 Stocare pe mobil (React Native / Expo)

| Token | Stocare | Motiv |
|-------|---------|-------|
| **Access token** | **doar în memorie** (state al aplicației / variabilă în `AuthContext`) | Durată scurtă (15 min); ținut în memorie nu ajunge niciodată pe disc. La kill/restart al aplicației dispare — se reobține instant prin refresh. Zero persistență = zero risc de exfiltrare de pe disc. |
| **Refresh token** | **Expo SecureStore** (`expo-secure-store`) | Trebuie persistat (30 zile), deci are nevoie de stocare securizată hardware-backed. |

**De ce `SecureStore` și NU `AsyncStorage`:**

- **`AsyncStorage`** salvează în **text clar (plaintext)**, într-o bază de date necriptată (SQLite pe Android, fișiere plist pe iOS). Orice acces la file system-ul dispozitivului (root/jailbreak, backup nesecurizat, malware) citește tokenul direct. Este **nepotrivit pentru secrete**.
- **`SecureStore`** folosește **enclavele securizate ale OS-ului**:
  - iOS → **Keychain** (criptat, protejat de Secure Enclave, opțiune `WHEN_UNLOCKED_THIS_DEVICE_ONLY`).
  - Android → **Keystore** (chei hardware-backed, criptare AES).
- Astfel refresh token-ul este criptat at-rest, legat de dispozitiv, și inaccesibil altor aplicații.

```ts
import * as SecureStore from 'expo-secure-store';

const REFRESH_KEY = 'flirt.refresh_token';

// La login / refresh
await SecureStore.setItemAsync(REFRESH_KEY, refreshToken, {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY, // nu iese în backup-uri iCloud/Google
});

// Access token: NU se persistă — trăiește doar în memorie
let accessToken: string | null = null;

// La logout
await SecureStore.deleteItemAsync(REFRESH_KEY);
accessToken = null;
```

### 1.5 Refresh token rotation + reuse detection

Fiecare apel la `/auth/refresh`:

1. **Consumă** refresh token-ul curent (`jti` vechi) și emite o **pereche nouă** (access + refresh nou cu `jti` nou).
2. `jti`-ul vechi este **invalidat imediat** — un refresh token e valid **o singură dată**. Aceasta este **rotația** (rotation).

Toate tokenurile derivate din același login formează o **familie** identificată de claim-ul `family`.

**Reuse detection (detecția reutilizării):**

- Dacă sosește un refresh token cu un `jti` **deja consumat** (rotit deja), înseamnă că același token a fost folosit de două ori. Singurele explicații: fie clientul legitim, fie un atacator care a furat tokenul — le folosesc amândoi.
- În acest caz **revocăm întreaga familie** (`family`): toate refresh tokenurile derivate din acel login sunt invalidate. Atât victima cât și atacatorul sunt deconectați; utilizatorul legitim se re-loghează (cu re-verificare provider), iar tokenul furat devine inutil.

**Stocare în Redis** (state pentru refresh; complementar entității `Session` din `data-models.md`):

```
# Un refresh token activ (rotația mută starea de la vechi la nou)
SET  refresh:{jti}   '{"user_id":"usr_...","family":"fam_...","status":"active"}'  EX 2592000

# Set-ul familiei — toate jti emise vreodată în acest login
SADD family:{family_id}  {jti_1} {jti_2} ...

# La reuse detection: marcăm familia compromisă și ștergem toate jti active
SET  family_revoked:{family_id}  1  EX 2592000
```

Pseudo-cod al logicii de refresh:

```python
async def rotate_refresh(token: str) -> TokenPair:
    payload = decode_jwt(token, algorithms=["RS256"])   # validează semnătura + exp
    jti, family, user_id = payload["jti"], payload["family"], payload["sub"]

    if await redis.exists(f"family_revoked:{family}"):
        raise SecurityError("token family revoked")      # familie deja compromisă

    stored = await redis.get(f"refresh:{jti}")
    if stored is None:
        # jti necunoscut sau deja consumat => REUSE => revocă toată familia
        await revoke_family(family)
        audit_log("refresh_reuse_detected", user_id=user_id, family=family)
        raise SecurityError("refresh token reuse detected")

    await redis.delete(f"refresh:{jti}")                 # consumă tokenul vechi (rotația)
    new_pair = issue_token_pair(user_id, family=family)  # jti nou, aceeași familie
    await redis.set(f"refresh:{new_pair.refresh_jti}",
                    json.dumps({...}), ex=REFRESH_TTL)
    await redis.sadd(f"family:{family}", new_pair.refresh_jti)
    return new_pair
```

### 1.6 Logout / revocare / "șterge toate sesiunile"

Corespunde secțiunii **Настройки** din TZ (6.3 — „Смена способа входа / привязанных аккаунтов", management sesiuni). Fiecare login = o entitate **`Session`** (vezi `data-models.md`), legată de o `family`.

- **Logout (sesiunea curentă):** revocăm familia curentă (`revoke_family(family)`); refresh token-ul se șterge din `SecureStore`; access-ul dispare din memorie. Access token-ul rămas trăiește cel mult 15 min — acceptabil dat fiind trade-off-ul stateless.
- **Revocare țintită:** utilizatorul vede lista sesiunilor active (dispozitiv, ultima activitate, locație aproximativă — din entitatea `Session`) și poate revoca oricare individual → `revoke_family` pe familia acelei sesiuni.
- **„Șterge toate sesiunile" / „Log out everywhere":** parcurgem toate familiile utilizatorului și le revocăm. Recomandat automat la: schimbare de parolă, schimbare metodă de login, sau după reuse detection.

```python
async def revoke_family(family_id: str):
    await redis.set(f"family_revoked:{family_id}", 1, ex=REFRESH_TTL)
    for jti in await redis.smembers(f"family:{family_id}"):
        await redis.delete(f"refresh:{jti}")

async def revoke_all_sessions(user_id: str):
    for family_id in await list_user_families(user_id):   # din tabela Session
        await revoke_family(family_id)
```

> **Revocare imediată a access-ului (opțional, high-security):** pentru acțiuni critice (ban de moderare, TZ 5.5/10) putem întreține o **denylist** de `jti` de access în Redis (TTL = 15 min) verificată în `get_current_user`. E un trade-off: adaugă un lookup Redis per request, deci se aplică **doar** conturilor banate/compromise, nu pe calea normală.

### 1.7 Diagramă de flux (text)

```
┌─────────┐                                   ┌──────────────┐        ┌─────────┐
│ Mobile  │                                   │  Auth API    │        │  Redis  │
│ (Expo)  │                                   │  (FastAPI)   │        │         │
└────┬────┘                                   └──────┬───────┘        └────┬────┘
     │                                               │                     │
  ①  │  POST /auth/login (provider / email+pass)     │                     │
     │──────────────────────────────────────────────▶│  validează credențiale
     │                                               │  issue token pair    │
     │                                               │  SET refresh:{jti}   │
     │                                               │──────────────────────▶│
     │   200 { access (15m), refresh (30d) }          │                     │
     │◀──────────────────────────────────────────────│                     │
  ②  │  access → memorie ; refresh → SecureStore      │                     │
     │                                               │                     │
  ③  │  GET /profiles   Authorization: Bearer <access>│                     │
     │──────────────────────────────────────────────▶│  verify RS256 sig    │
     │                                               │  check exp/scope/age │
     │   200 (date)                                   │  (stateless)         │
     │◀──────────────────────────────────────────────│                     │
     │                                               │                     │
     │        ... după 15 min access expiră (401) ... │                     │
     │                                               │                     │
  ④  │  POST /auth/refresh { refresh }                │                     │
     │──────────────────────────────────────────────▶│  GET refresh:{jti}   │
     │                                               │──────────────────────▶│
     │                                               │  DEL vechi + SET nou │
     │                                               │  (rotation)          │
     │                                               │  ⚠ dacă jti consumat │
     │                                               │     => revoke family │
     │   200 { access nou, refresh nou }              │                     │
     │◀──────────────────────────────────────────────│                     │
  ⑤  │  Logout / "log out everywhere":                │                     │
     │  POST /auth/logout ─────────────────────────▶ │  revoke_family(...)  │
     │                                               │  DEL refresh:{jti}   │
     │  SecureStore.delete(refresh); access = null    │──────────────────────▶│
     │                                               │                     │
```

### 1.8 Snippet FastAPI

```python
# ── config & chei ────────────────────────────────────────────────────────────
from datetime import datetime, timedelta, timezone
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
import jwt   # PyJWT
import uuid

ACCESS_TTL  = timedelta(minutes=15)
REFRESH_TTL = timedelta(days=30)
ISSUER, AUDIENCE = "https://api.flirt.app", "flirt-mobile"

PRIVATE_KEY = load_secret("JWT_PRIVATE_KEY")   # din secret manager, NU din cod
PUBLIC_KEY  = load_secret("JWT_PUBLIC_KEY")

bearer = HTTPBearer(auto_error=True)


# ── creare token ─────────────────────────────────────────────────────────────
def create_access_token(user: "User") -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user.id,
        "iss": ISSUER,
        "aud": AUDIENCE,
        "iat": now,
        "exp": now + ACCESS_TTL,
        "jti": f"at_{uuid.uuid4().hex}",
        "scope": user.role,                 # "user" | "moderator" | "admin"
        "age_group": user.age_group,        # "16_17" | "18plus"
        "verified": user.is_face_verified,
        "token_type": "access",
    }
    return jwt.encode(payload, PRIVATE_KEY, algorithm="RS256",
                      headers={"kid": ACTIVE_KEY_ID})


# ── principal autentificat ───────────────────────────────────────────────────
class CurrentUser(BaseModel):
    id: str
    role: str
    age_group: str
    verified: bool


async def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
) -> CurrentUser:
    try:
        payload = jwt.decode(
            creds.credentials, PUBLIC_KEY,
            algorithms=["RS256"],           # fixăm algoritmul — anti alg=none / confusion
            audience=AUDIENCE, issuer=ISSUER,
            options={"require": ["exp", "iat", "sub"]},
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token")

    if payload.get("token_type") != "access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "wrong token type")

    # (opțional, doar pentru conturi banate) verificare denylist jti în Redis
    if await redis.exists(f"denylist:{payload['jti']}"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token revoked")

    return CurrentUser(
        id=payload["sub"], role=payload["scope"],
        age_group=payload["age_group"], verified=payload["verified"],
    )


# ── gardă de vârstă pentru rute 18+ (TZ 2.3) ─────────────────────────────────
def require_adult(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if user.age_group != "18plus":
        # minorii 16-17 nu au acces la "без обязательств" / conținut 18+
        raise HTTPException(status.HTTP_403_FORBIDDEN, "adults only (18+)")
    return user


def require_verified(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not user.verified:                   # TZ 2.2 — acțiuni limitate până la verificare
        raise HTTPException(status.HTTP_403_FORBIDDEN, "face verification required")
    return user


# ── exemple de rute ──────────────────────────────────────────────────────────
app = FastAPI()

@app.get("/me")
async def me(user: CurrentUser = Depends(get_current_user)):
    return {"id": user.id, "age_group": user.age_group}

@app.get("/feed/no-strings")     # secțiunea "Без обязательств" — doar 18+
async def casual_feed(user: CurrentUser = Depends(require_adult)):
    return await build_casual_feed(user.id)
```

---

## 2. Login providers

TZ 2.1 cere patru metode de intrare. Toate converg către același model de tokenuri (secțiunea 1). Principiu comun: backend-ul **nu are încredere** în identitatea trimisă de client — o verifică independent la sursă.

### 2.1 Sign in with Apple

- Clientul obține un **`identity_token`** (JWT semnat de Apple) și un `authorization_code`; le trimite la `/auth/apple`.
- Backend-ul **validează JWT-ul Apple**: descarcă cheile publice Apple din `https://appleid.apple.com/auth/keys` (JWKS, cache-uite), verifică semnătura, `iss == https://appleid.apple.com`, `aud == <bundle_id-ul FLIRT>`, `exp` valid, și `nonce`-ul (legat de request pentru anti-replay).
- Emailul poate fi relay privat Apple (`@privaterelay.appleid.com`) — îl acceptăm ca atare; identificatorul stabil este `sub` (Apple user ID), **nu** emailul.
- Nu stocăm niciodată parole; legăm `apple_sub` de contul intern.

### 2.2 Google Sign-In

- Clientul obține un **ID token** Google; backend verifică JWT-ul cu JWKS Google (`https://www.googleapis.com/oauth2/v3/certs`), `iss ∈ {accounts.google.com, https://accounts.google.com}`, `aud == GOOGLE_CLIENT_ID` al FLIRT, `exp`, și `email_verified == true`.
- Nu ne bazăm pe emailul din payload fără `email_verified`; identificatorul stabil este `sub`-ul Google.

### 2.3 Email + parolă

- **Hashing cu Argon2id** (preferat; `argon2-cffi`) — rezistent la atacuri GPU/ASIC, cu parametri `memory`, `time`, `parallelism` calibrați. Alternativă acceptabilă: **bcrypt** (cost ≥ 12). **Niciodată** MD5/SHA fără sare.
- Argon2 include sarea automat; fiecare hash e unic chiar la parole identice.
- Politici: lungime minimă (≥ 8–10), verificare împotriva listelor de parole compromise (k-anonymity HaveIBeenPwned), rate-limit pe login (2.5) și **mesaje de eroare identice** pentru „email inexistent" vs „parolă greșită" (anti-enumerare, vezi 5).
- Reset parolă: token cu entropie mare, **single-use**, TTL scurt (~30 min), trimis pe email; la reset → `revoke_all_sessions` (1.6).

```python
from argon2 import PasswordHasher
ph = PasswordHasher()                       # Argon2id, parametri OWASP

hash_ = ph.hash(plain_password)             # la înregistrare
try:
    ph.verify(hash_, plain_password)        # la login
    if ph.check_needs_rehash(hash_):        # re-hash dacă params s-au întărit
        hash_ = ph.hash(plain_password)
except VerifyMismatchError:
    raise HTTPException(401, "invalid credentials")   # mesaj generic
```

### 2.4 Telefon + OTP (SMS)

- Cod **OTP numeric de 6 cifre**, generat criptografic (`secrets`), cu **expirare scurtă (~5 min)**.
- În Redis stocăm doar **hash-ul codului** (nu codul clar), cu TTL:
  ```
  SET otp:{phone}  '{"hash": "...", "attempts": 0}'  EX 300
  ```
- **Rate limiting pe mai multe axe** (anti-abuz / anti-cost SMS):
  - max N cereri de cod / telefon / oră și / IP / oră;
  - max 5 încercări de verificare per cod, apoi codul e invalidat (anti brute-force pe 6 cifre);
  - cooldown între cereri de retrimitere (ex. 60 s).
- Verificare numărului via provider (Twilio Verify / similar); numărul se normalizează E.164.
- Protecție anti **SIM-swap** pentru acțiuni sensibile: la schimbarea numărului → re-verificare + `revoke_all_sessions`.

---

## 3. Verificare facială / biometrie (TZ 2.2)

Pas **obligatoriu** pentru toate conturile noi. Este cea mai sensibilă categorie de date (biometrie — **date de categorie specială** sub GDPR Art. 9), deci tratată separat și cu cel mai strict regim.

### 3.1 Fluxul de verificare

1. **Liveness check (în aplicație):** utilizatorul face un selfie / scurt video live cu provocări active (întoarce capul, clipește). Scop: dovada că e o persoană reală, prezentă, nu o fotografie/deepfake/înregistrare. Provocările sunt randomizate server-side (anti-replay).
2. **Face-match:** selfie-ul este comparat cu fotografiile din anchetă printr-un model de face-matching (ex. **AWS Rekognition** `CompareFaces` / echivalent — furnizorul final e o întrebare deschisă TZ 12).
3. **Rezultat:**
   - succes → profilul devine `verified = true`, primește badge-ul „✓ Верифицирован" (TZ 2.2), vizibilitate completă în feed;
   - eșec → profil `не подтверждена`, vizibilitate redusă/ascunsă (configurabil backend), posibilitate de reîncercare cu back-off.

### 3.2 Unde și cum se stochează datele biometrice

Principiul director: **minimizare** — nu stocăm imagini biometrice brute mai mult decât strict necesar.

- **Procesare efemeră:** selfie-ul/video-ul de liveness se procesează în memorie / storage temporar și se **șterge imediat** după obținerea rezultatului. Nu ajunge în storage-ul de profile obișnuit.
- Dacă furnizorul returnează un **template biometric** (vector de trăsături facial), acesta se stochează:
  - într-un **store dedicat, izolat** de restul datelor de aplicație (bucket/tabelă separată, chei de acces distincte, blast-radius minim);
  - **criptat at-rest** cu chei gestionate prin **KMS** (envelope encryption — vezi 4.1);
  - legat de `user_id` doar prin referință, fără a fi expus în API-urile publice.
- **Fotografiile de profil** (non-biometrice ca scop) rămân în storage-ul media obișnuit (obiect storage privat, acces prin URL-uri semnate cu expirare scurtă).
- **Rezultatul verificării** (scor de similaritate, timestamp, pass/fail, `verified` flag) se stochează ca metadata, **fără** imaginile în sine.

### 3.3 Criptare at-rest, retenție și ștergere (GDPR / TZ 12)

- **Criptare at-rest:** toate artefactele biometrice (template-uri, eventuale imagini temporare) sunt criptate (AES-256, chei KMS). Cheile sunt rotite periodic.
- **Bază legală & consimțământ:** procesarea biometrică necesită **consimțământ explicit** (GDPR Art. 9(2)(a)), colectat printr-un ecran dedicat înainte de captură, cu explicație clară a scopului și retenției. Consimțământul e logat (audit, 4.6).
- **Retenție minimă:** imaginile de liveness — șterse imediat după verificare; template-ul biometric — păstrat **doar** cât e util scopului (de ex. re-verificare periodică sau anti-fraudă), cu politică de retenție configurabilă.
- **Ștergere la ștergerea contului:** la ștergerea contului (TZ 6.3, perioadă de recuperare 30 zile — vezi 4.5), **toate** datele biometrice sunt șterse definitiv (hard delete, inclusiv din backup-uri conform politicii), la finalul perioadei de grație. Ștergerea biometriei nu trebuie amânată dincolo de necesar.
- **Localizarea datelor:** hosting-ul datelor de verificare respectă cerințele GDPR / legislația locală privind biometria (rămâne de confirmat cu clientul — TZ 12: furnizor face-verification, locația hosting-ului, termenele de ștergere).
- **Fără decizii pur automate ireversibile** fără cale de contestație: un eșec de verificare permite reîncercare / revizuire manuală (aliniat GDPR Art. 22).

---

## 4. Protecția datelor personale

### 4.1 Criptare at-rest a câmpurilor sensibile

- **Criptare la nivel de disc/volum** (storage encryption) pentru toate bazele de date — bază minimă.
- **Criptare la nivel de câmp (application-level / envelope encryption)** pentru câmpurile deosebit de sensibile, astfel încât nici un dump de DB să nu le expună în clar:
  - coordonate exacte / stradă / district (vezi 4.2),
  - număr de telefon, email (când nu sunt necesare pentru indexare — altfel hash pentru lookup),
  - template-uri biometrice (secțiunea 3),
  - conținutul mesajelor (la minimum criptat at-rest; recomandat câmp criptat).
- **Envelope encryption:** o **Data Encryption Key (DEK)** criptează datele; DEK-ul e criptat cu o **Key Encryption Key (KEK)** din **KMS** (AWS KMS / Vault). Cheile nu stau niciodată în cod sau în DB în clar; sunt aduse din secret manager.
- **Secrete** (chei JWT, credențiale DB, chei API providers) — **doar** în secret manager (AWS Secrets Manager / Vault), injectate ca variabile de mediu la runtime, niciodată commit-uite.

### 4.2 Niciodată adresa exactă — doar distanță (TZ 7)

Conform TZ 7, adresa precisă a unui utilizator **nu este niciodată expusă** altui utilizator:

- La înregistrare, orașul + (opțional) strada/districtul se **geocodează** în coordonate (lat/lng) prin serviciul de geocodare (Google Maps / Mapbox).
- Coordonatele exacte se stochează **criptat** și **nu sunt niciodată** serializate în răspunsurile API către alți useri.
- API-ul returnează **doar distanța aproximativă**, calculată server-side cu formula **haversine** (ex. „3 км от вас"), respectând raza de căutare setată de utilizator.
- Recomandat pentru anti-triangulare (trilateration): **quantizarea** distanței (rotunjire la trepte, ex. 1 km) și/sau **snapping** la centrul unei zone/grile geografice, astfel încât nici măcar prin măsurători repetate din locații diferite să nu se poată reconstrui poziția exactă.

### 4.3 Mascare contacte în chat (TZ 5.5)

Un modul NLP scanează în timp real mesajele **trimise** (outbound) pentru date de contact, care sunt **mascate cu asteriscuri** înainte de a fi livrate/stocate:

- Ce se detectează: numere de telefon, email, nickname-uri de rețele sociale / mesagerie (Instagram, Telegram, WhatsApp etc.), link-uri externe.
- Mascarea se face **server-side** (nu ne bazăm pe client), astfel încât mesajul stocat și cel livrat conțin deja versiunea mascată — „мой телеграм ******" în loc de nickname-ul real (TZ 5.5).
- Utilizatorului i se afișează o notă discretă explicând de ce contactul a fost ascuns.
- Detecția combină regex-uri (telefon/email/URL) cu clasificare NLP pentru cazuri obfuscate (ex. „t e l e g r a m", „insta @ ..."). Evenimentele alimentează semnalele de moderare (5.4).

### 4.4 Minor safety 16–17 (TZ 2.3)

- **Separare strictă a feed-urilor:** userii 16–17 văd **numai** profile 16–17; 18+ văd numai 18+. Aplicat la nivel de query (filtrare pe `age_group`) **și** de gardă pe rute (`require_adult`, secțiunea 1.8).
- Minorii **nu** au acces la secțiunea „Без обязательств" și **nu** pot publica conținut explicit/18+.
- **Filtru de conținut și moderare întărite** pentru grupa 16–17 (praguri mai stricte în modulul de moderare, 5.4).
- `age_group` derivă din data nașterii, e legat de token (1.3) și **nu poate fi setat de client** — orice tentativă de a-l manipula e ignorată server-side.

### 4.5 Ștergere cont cu perioadă de recuperare 30 zile (TZ 6.3)

- La cererea de ștergere, contul intră în stare **`pending_deletion`** cu timestamp; utilizatorul se poate reactiva în **30 de zile** (soft delete + perioadă de grație).
- În perioada de grație: profilul e **invizibil** în feed, sesiunile sunt revocate (`revoke_all_sessions`, 1.6), dar datele se păstrează pentru posibila recuperare.
- La expirarea celor 30 zile: **hard delete / anonimizare** — datele personale sunt șterse sau anonimizate ireversibil, inclusiv:
  - **biometria** (secțiunea 3) — ștearsă definitiv;
  - fotografii, mesaje (sau anonimizate acolo unde e nevoie de integritate conversațională pentru celălalt participant), date de profil, coordonate.
- Ștergerea propagă în backup-uri conform politicii de retenție a backup-urilor (documentat, cu termen maxim).
- Un job programat (scheduled worker) parcurge conturile `pending_deletion` expirate și execută purjarea; fiecare purjare e înregistrată în audit log.

### 4.6 Audit logging

- Se loghează evenimentele sensibile de securitate și confidențialitate: login (succes/eșec), refresh, **reuse detection** (1.5), logout / revocare sesiuni, schimbare parolă/metodă login, consimțământ biometric, verificare facială (rezultat), acțiuni de moderare/ban (5.4), cereri de ștergere cont și purjare (4.5), acces la date personale de către staff/moderatori.
- Structura unui log: `timestamp`, `actor` (user/staff/system), `action`, `target`, `ip`, `user_agent`, `result`. **Fără** date sensibile în clar (fără parole, fără OTP, fără conținut biometric).
- Loguri **append-only**, cu retenție definită, acces restricționat. Utile pentru investigații de securitate și pentru dovada conformității GDPR (accountability).

---

## 5. Hardening API

### 5.1 Rate limiting

- **Multi-nivel:** global per IP, per user (`sub`), și per endpoint sensibil (login, OTP, refresh, reset parolă, raportare).
- Implementat centralizat (API gateway / middleware) cu backend Redis (token bucket / sliding window). Vezi limitele specifice OTP la 2.4.
- Protejează contra brute-force, credential stuffing, scraping de profile și abuz de cost (SMS).
- Răspuns `429 Too Many Requests` cu `Retry-After`.

### 5.2 HTTPS / TLS

- **TLS obligatoriu** (min. TLS 1.2, preferat 1.3) pe tot traficul; HTTP redirecționat/refuzat.
- Header **HSTS** (`Strict-Transport-Security`, `max-age` mare, `includeSubDomains`).
- Recomandat **certificate pinning** în aplicația mobilă pentru endpoint-urile critice (auth), reducând riscul de MITM.

### 5.3 CORS

- API-ul e consumat în principal de aplicația mobilă (fără origin de browser), deci CORS e **restrictiv by default**.
- Pentru eventualul admin panel web: **allow-list explicit** de origini (nu `*`), metode și headere minime necesare, `Allow-Credentials` doar unde e strict nevoie.
- Nu se combină niciodată `Access-Control-Allow-Origin: *` cu credențiale.

### 5.4 Moderare automată & ban (TZ 5.5 / 10)

- Semnalele de moderare vin din: raportări în chat (spam, profil fake, insulte, poze indecente — TZ 5.5), detecția NLP de contacte (4.3), potriviri cu baza de conținut interzis, comportament anormal.
- **Ban automat cu încredere mare:** la potrivire exactă cu baza de conținut interzis sau la **mai multe raportări independente**, contul este blocat automat, **fără** a aștepta revizuire manuală (TZ 5.5/10). Cazurile ambigue intră într-o **coadă de moderatori** pentru verificare manuală.
- Ban-ul declanșează **revocarea imediată a sesiunilor** (1.6) și, pentru efect instant, adăugarea `jti`-urilor de access în denylist (1.6, opțional).
- Praguri **mai stricte** pentru grupa 16–17 (4.4).
- Fiecare decizie de moderare e în audit log (4.6), cu cale de contestație.

### 5.5 Protecție împotriva enumerării

- **Mesaje de eroare uniforme:** login, „forgot password", verificare OTP și înregistrare returnează răspunsuri **indistinctibile** indiferent dacă emailul/telefonul există sau nu (nici status code, nici text, nici timp de răspuns diferit — atenție la **timing attacks**: se face verify pe un hash dummy chiar și când userul nu există).
- **ID-uri neenumerabile:** identificatorii publici sunt opaci (UUID / ULID prefixat, ex. `usr_...`), nu întregi secvențiali, pentru a împiedica ghicirea/scraping-ul resurselor.
- Rate limiting (5.1) pe endpoint-urile care ar putea fi folosite pentru enumerare.

### 5.6 Input validation (Pydantic)

- **Toate** payload-urile de intrare sunt modele **Pydantic** cu tipuri, constrângeri (`constr`, `conint`, `EmailStr`, lungimi min/max, regex, enum pentru câmpuri ca `age_group`, `gender`, `status`) — request-urile invalide sunt respinse cu `422` înainte de a atinge logica de business.
- Reguli specifice: min 3 / max 9 fotografii (TZ 2.4), „despre mine" ≤ 500 caractere, vârstă ≥ 16 (validare dată naștere), rază de căutare în interval valid.
- **Anti mass-assignment:** modele separate pentru input vs. output; câmpuri sensibile (`role`, `age_group`, `verified`, `id`) **nu** pot fi setate din request-ul clientului — se derivă/atribuie server-side.
- **ORM parametrizat** (SQLAlchemy) pentru a preveni SQL injection; escaping/sanitizare la output pentru câmpurile text afișate (anti-XSS în admin panel).
- Limite de dimensiune pe request body și pe upload-uri de media (anti-DoS), plus validare de tip MIME și scanare a media încărcate.

---

## Rezumat rapid al deciziilor cheie

- **Două tokenuri:** access JWT scurt (15 min, stateless, în memorie) + refresh rotativ (30 zile, stateful în Redis, în SecureStore).
- **RS256** cu chei asimetrice + JWKS pentru rotație.
- **Refresh rotation + reuse detection** cu revocare pe **familie** de tokenuri.
- **SecureStore, nu AsyncStorage**, pentru refresh (Keychain / Keystore, criptat at-rest).
- **`age_group`** în token + gardă `require_adult` pentru izolarea 16–17 vs 18+ (TZ 2.3).
- **Biometrie** izolată, criptată KMS, minimizată, ștearsă la ștergerea contului (TZ 2.2 / 12).
- **Adresă exactă niciodată expusă** — doar distanță haversine quantizată (TZ 7).
- **Mascare contacte server-side** în chat (TZ 5.5) + moderare automată cu ban (TZ 5.5/10).
- **Ștergere cont cu 30 zile grație**, apoi hard delete (TZ 6.3).
- **Hardening:** rate limiting, TLS/HSTS, CORS restrictiv, anti-enumerare, validare Pydantic.
```
