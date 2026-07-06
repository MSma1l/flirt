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

## Amânat intenționat (❌ — mai târziu)
- ❌ Verificare facială / liveness (TZ 2.2).
- ❌ Înregistrare prin telefon + OTP (TZ 2.1).
- ❌ Upload poze anketă (TZ 2.4) — momentan doar câmp opțional de URL-uri.
- ❌ Swipe / Compatibility / Chat / Events / Monetizare — etape următoare.

## Cum rulezi
- Backend teste: `cd backend && . .venv/bin/activate && pytest`
- Backend deploy: `cd backend && cp .env.example .env && docker compose up --build`
- Mobile teste: `cd mobile && npm test`
- Mobile dev: `cd mobile && npm start`
