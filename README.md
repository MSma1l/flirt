# FLIRT — No Regrets

Aplicație de dating (iOS / Android) construită în jurul a trei piloni: **swipe cu scor de
compatibilitate**, **chat cu mascarea contactelor** și **evenimente offline „Flirt Party"**
(cu check-in și „Flirt Passport").

**Aplicația e 18+ only.** Segmentul 16–17 din sarcina tehnică inițială a fost eliminat complet
(vezi [`PROGRESS.md`](./PROGRESS.md) → „Decizii de produs").

| Componentă | Stack | Stare |
|---|---|---|
| **Backend** | Python 3.12 · FastAPI · SQLAlchemy 2.0 async · PostgreSQL 16 · Redis · Alembic | ✅ deployabil, validat pe stiva reală |
| **Mobile** | React Native · Expo · expo-router · TypeScript strict · React Query · Zustand | ✅ funcțional; ❌ build de store blocat (vezi mai jos) |
| **Admin** | React · Vite · TypeScript | ✅ funcțional |
| **Infra** | Docker Compose · nginx (TLS/Let's Encrypt) · gunicorn | ✅ un singur `docker compose up` |

**Cifre reale** (verificate prin rulare, nu estimate):

| | |
|---|---|
| Teste backend | **445** (37 fișiere), acoperire **83%** |
| Teste mobile | **340** (57 suite) |
| Teste admin | **19** (6 fișiere) |
| API | **79 operațiuni** pe **68 căi** (58 publice + 21 admin) |
| Bază de date | **22 tabele**, 13 migrații Alembic |

---

## Structura repo-ului

```
backend/     FastAPI + Postgres + Redis + nginx + Docker Compose (tot deploy-ul)
mobile/      aplicația Expo (proiect SEPARAT, nu face parte din stack-ul de server)
admin/       panoul de administrare (SPA React + Vite, servit de nginx)
docs/        documentația tehnică — vezi docs/README.md
PROGRESS.md  sursa de adevăr: ce e gata, ce nu, ce e amânat și de ce
SECURITY.md  breșele găsite la audit și cum au fost închise
```

---

## Cum rulezi local

### Backend

```bash
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -e '.[dev]'
cp .env.example .env          # merge ca atare în development (toți providerii pe `stub`)
python -m pytest -q           # 445 teste
uvicorn app.main:app --reload # http://localhost:8000/docs
```

Fără chei externe nu trebuie nimic: fiecare integrare (storage, geo, auth social, OTP, push,
billing, verificare facială) are o implementare **stub** funcțională. Comutarea pe „live" se
face exclusiv din `.env` — vezi [`docs/INTEGRATIONS.md`](./docs/INTEGRATIONS.md).

### Mobile

```bash
cd mobile
npm install
npm test                      # 340 teste, 57 suite
npm start                     # Expo dev server
```

### Admin

```bash
cd admin
npm install
npm test                      # 19 teste
npm run dev                   # http://localhost:5173
```

### Stiva completă în Docker (ca în producție)

```bash
cd backend
cp .env.example .env
docker compose up --build
```

Pornește api + Postgres + Redis + nginx + build-ul panoului de admin. Migrațiile rulează singure.

---

## Cum deployezi

Procedura completă (server gol → `https://api.flrt.md` live, cu TLS emis automat) e în
**[`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)**. Pe scurt, după ce `.env` e completat o dată:

```bash
cd /opt/flirt && git pull
cd backend && docker compose up --build -d
```

Domeniile reale:

| Domeniu | Ce servește |
|---|---|
| `api.flrt.md` | API-ul (aplicația mobilă vorbește doar aici) |
| `admin-flirt-paty.flrt.md` | panoul de admin |

> Domeniul e **`flrt.md`**, nu `flirt.md` (care nu există în DNS).

Primul cont de admin se creează cu un script, din interiorul containerului:

```bash
docker compose exec api python scripts/create_admin.py admin@flrt.md
```

---

## Ce NU e gata (onest)

- ❌ **Plăți IAP native** (StoreKit / Google Play Billing) — **amânate de client**.
  **Fără IAP nu se poate face submit la App Store** (Guideline 3.1.1). **Blocantul #1 al lansării.**
  Și e mai mult decât „lipsește SDK-ul": schema `PurchaseIn` **nu are câmp `receipt`**, deci
  validarea de receipt scrisă pe backend e inaccesibilă prin API — cu un provider live, orice
  achiziție întoarce `402`. Câmpul trebuie adăugat **înaintea** SDK-ului nativ.
- ❌ **Cameră / selfie de verificare facială** — amânată de client. Backend-ul (Rekognition) și
  ecranul există; nicio imagine nu e capturată.
- ❌ **Login social nativ** (stub). Guideline 4.8: dacă oferi Google, Apple cere **obligatoriu** și
  Sign in with Apple. Ori amândouă, ori niciuna.
- ❌ **Push real** — `expo-notifications` nu e instalat; tokenul înregistrat e un șir fals.
- ⚠️ **URL-urile legale** (termeni / confidențialitate / suport) sunt încă placeholder-e către
  `https://flirt.app/...` — un domeniu care nu e al nostru. Obligatorii la submit.

Detalii, procente realiste și restul listei: [`PROGRESS.md`](./PROGRESS.md).

---

## Documentație

Punctul de intrare: **[`docs/README.md`](./docs/README.md)**.

| Document | Conținut |
|---|---|
| [`PROGRESS.md`](./PROGRESS.md) | Ce e implementat, ce nu, ce e amânat — cu procente |
| [`SECURITY.md`](./SECURITY.md) | Audit de securitate: breșele găsite și închise |
| [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) | Deploy pas cu pas, testat pe stiva reală |
| [`docs/INTEGRATIONS.md`](./docs/INTEGRATIONS.md) | Cheile externe necesare, per integrare |
| [`docs/architecture.md`](./docs/architecture.md) | Arhitectura reală (componente, fluxuri) |
| [`docs/backend/`](./docs/backend/) | API, modele de date, securitate |
| [`docs/frontend/`](./docs/frontend/) | Ecrane, navigare, styling |
| [`docs/admin/`](./docs/admin/) | Panoul de administrare |
| [`docs/design-system/`](./docs/design-system/) | Paletă, tipografie, componente |

Sursele de referință ale proiectului: `FLIRT TZ.docx` (sarcina tehnică),
`flirt_paleta_culori.png` (paleta), `FLIRT Prototype (standalone).html` (prototipul UI).
