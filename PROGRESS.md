# FLIRT — Evidența progresului

Registru a ceea ce s-a implementat, ca să nu repetăm munca. Actualizat la fiecare etapă.

## Legendă
✅ gata & testat · 🚧 în lucru · ⏳ planificat · ❌ amânat intenționat

---

## Etapa 0 — Documentație (✅)
- `docs/` — arhitectură completă: overview, system architecture, design-system (paletă exactă),
  frontend (RN Expo), backend (FastAPI), securitate (JWT). Generată din TZ + paletă + prototip.
- `.context/` — TZ.txt (sarcina tehnică extrasă) + DESIGN_TOKENS.md (paletă).

## Etapa 1 — Schelet proiect (✅)
Fundație fără hardcodare, cu puncte de integrare curate.

### Backend (`backend/`)
- Config centralizat din env (`app/core/config.py`), zero valori hardcodate.
- DB async SQLAlchemy 2.0 (`app/db/`), Base cu uuid + timestamps.
- FastAPI app + CORS + `/health` (`app/main.py`), agregator rute v1.
- **Deploy din start**: `Dockerfile` (multi-stage, non-root), `docker-compose.yml`
  (api + Postgres 16 + Redis 7 + **nginx** reverse proxy), `entrypoint.sh` (alembic + gunicorn).
- Alembic async configurat (`alembic/env.py`).
- Teste pe SQLite in-memory (`tests/conftest.py`, chei RSA efemere).

### Mobile (`mobile/`) — aplicație SEPARATĂ
- Expo + expo-router + TypeScript strict, aliasuri `@/`, `@theme/`.
- **Temă** din paletă exactă (`theme/colors.ts` dark+light, typography Manrope, ThemeProvider).
- Componente UI de bază: `Button`, `Input`, `ScreenContainer`, `ProgressDots`.
- Client HTTP cu **JWT Bearer + refresh automat** (`src/services/api.ts`), token store
  (access în memorie, refresh în SecureStore).
- Auth store Zustand (`src/store/authStore.ts`).
- Root layout cu providers (temă, react-query), fonturi Manrope, hidratare sesiune.

## Etapa 2 — Auth + Anketă (✅ gata & testat)
Scope: **login (email+parolă) → onboarding → anketă**. Fără telefon/OTP. Fără verificare facială.
- ✅ Backend auth: register/login/refresh(rotație+reuse detection)/logout/me + teste. **12 teste ✔**
- ✅ Backend anketă: modele Profile/Interest, `/profiles/reference`, `PUT /profiles/me` + teste.
- ✅ Migrație Alembic inițială (users, refresh_sessions, profiles, interests, profile_interests).
- ✅ Mobile auth: splash+redirect, welcome, login, register + teste.
- ✅ Mobile anketă: wizard multi-pas (opțiuni din backend, fără hardcodare) + teste. **31/31 Jest ✔, tsc curat**

Verificat de sub-agenți dedicați: backend `pytest` 12/12, mobile `jest` 31/31 + `tsc --noEmit` curat.

## Etapa 3 — Navigare 3 taburi + Feed de swipe (✅ gata & testat)
Ecranul principal (TZ secț. 3–4).
- ✅ Backend feed: Compatibility Score (TZ 4.6, ponderi ca constante), `GET /feed` (excludere self/
  swipe-uiți + separare vârstă 16-17/18+), `POST /feed/swipe` (like/dislike → match reciproc),
  `GET /feed/matches`. Modele `Like`/`Match` + migrație Alembic. **17 teste ✔**
- ✅ Mobile: tab bar 3 taburi (Ankete/Mesaje/Setări), swipe deck cu `ProfileCard` + `CompatBadge`
  (verde/galben/gri), butoane like/dislike, `MatchModal` „Connect!", ecran Mesaje (matches),
  ecran Setări (temă light/dark/system + logout). **40 teste ✔, tsc curat**
- ❌ Gesturi de swipe (reanimated/gesture-handler) — momentan butoane; le adăugăm ulterior.

## Etapa 4 — Chat / Mesaje (✅ gata & testat)
TZ secț. 5.
- ✅ Backend chat: modele `Chat`/`Message`, `GET /chats` (dialoguri din match-uri + unread), 
  `GET/POST /chats/{id}/messages`, `POST /chats/{id}/read`. **Mascare contacte (TZ 5.5)**:
  `contact_masker` ascunde telefon/email/URL/@handle/mesagerie. Migrație Alembic. **28 teste ✔**
- ✅ Mobile chat: listă dialoguri (`mesaje` tab, unread badge, polling), ecran conversație
  `chat/[id]` (bule mesaje, hint „contact ascuns", input+trimite, mark-read). **49 teste ✔, tsc curat**
- ❌ Realtime WebSocket — momentan polling (React Query); WS ulterior.

## Amânat intenționat (❌ — mai târziu)
- ❌ Verificare facială / liveness (TZ 2.2).
- ❌ Înregistrare prin telefon + OTP (TZ 2.1).
- ❌ Upload poze anketă (TZ 2.4) — momentan doar câmp opțional de URL-uri.
- ❌ Swipe / Compatibility / Chat / Events / Monetizare — etape următoare.

## 🔎 Gate de revizuire finală (cerut de user)
La finalul întregii dezvoltări (nu doar per-etapă): revizuire completă cu **sub-agenți în paralel**
care verifică că tot codul corespunde și funcționează conform `docs/` și prototipului de design
(paletă + `FLIRT Prototype (standalone).html`). Acoperă: conformitate TZ, potrivire UI/paletă,
corectitudine, teste verzi, zero hardcodare.

## Cum rulezi
- Backend teste: `cd backend && . .venv/bin/activate && pytest`
- Backend deploy: `cd backend && cp .env.example .env && docker compose up --build`
- Mobile teste: `cd mobile && npm test`
- Mobile dev: `cd mobile && npm start`
