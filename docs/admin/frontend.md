# FLIRT — Panoul de administrare (SPA)

> Aplicația web a panoului de admin: `admin/` — **React 18 + Vite + TypeScript**, servită static de nginx pe `admin-flirt-paty.flrt.md`.
> API-ul pe care îl consumă e documentat în [`api.md`](./api.md); modelul de securitate al backend-ului, în [`README.md`](./README.md).

---

## Cuprins

1. [Stack și de ce](#1-stack-și-de-ce)
2. [Paginile](#2-paginile)
3. [Autentificarea — de ce în doi pași](#3-autentificarea--de-ce-în-doi-pași)
4. [Stratul HTTP](#4-stratul-http)
5. [Build și servire în producție](#5-build-și-servire-în-producție)
6. [Teste](#6-teste)
7. [Limite cunoscute](#7-limite-cunoscute)

---

## 1. Stack și de ce

| Domeniu | Alegere | De ce |
|---|---|---|
| Build | **Vite 7** | Build rapid; `VITE_*` sunt inline-uite la build (contează pentru `VITE_API_URL`). |
| UI | **React 18** + TypeScript | — |
| Rutare | **react-router-dom v6** (`BrowserRouter`) | SPA clasic; nginx face fallback pe `index.html`. |
| State server | **@tanstack/react-query** | Aceeași convenție ca pe mobil. Paginare cu cursor prin `useInfiniteQuery`. |
| Grafice | **recharts** | Doar pe dashboard. |
| Teste | **Vitest** (jsdom) + Testing Library | — |

`tsconfig` e **mai strict decât pe mobil**: pe lângă `strict`, are `noUnusedLocals`,
`noUnusedParameters`, `noFallthroughCasesInSwitch`, `noUncheckedIndexedAccess`. Build-ul e
gate-uit de typecheck: `"build": "tsc --noEmit && vite build"` — o eroare de tip **nu ajunge** în producție.

Toate paginile în afară de `LoginPage` sunt încărcate cu **`React.lazy`**, deliberat: `recharts` e
grea și n-are ce căuta în bundle-ul de login sau de moderare — ecranele pe care un moderator le
deschide cel mai des.

---

## 2. Paginile

Toate, mai puțin `/login`, sunt în spatele lui `RequireAdmin` + `Layout` (sidebar).

| Rută | Fișier | Ce face |
|---|---|---|
| `/login` | `src/pages/LoginPage.tsx` | Email + parolă. Traduce erorile **exact**: `401` credențiale greșite · `403` contul nu e admin / e banat · `429` rate limit · status `0` serverul e picat. |
| `/dashboard` | `src/pages/DashboardPage.tsx` | Cifrele-cheie + serii temporale (recharts), cu selector de interval. |
| `/moderation` | `src/pages/ModerationPage.tsx` | **Coada de moderare** — cele în așteptare primele, cu vârsta raportului vizibilă. Fiecare acțiune trece printr-un `ConfirmDialog`. |
| `/users` | `src/pages/UsersPage.tsx` | Căutare + filtre, paginare pe cursor, fișa userului, ban/unban, **ștergere GDPR cu dublă confirmare** (dialog + tastarea emailului contului). |
| `/events` | `src/pages/EventsPage.tsx` | CRUD evenimente. **Singura sursă de evenimente reale** pentru aplicația mobilă. |
| `/subscriptions` | `src/pages/SubscriptionsPage.tsx` | Listare + acordare manuală (suport / compensații / testeri). |

Orice rută necunoscută → redirect la `/dashboard`.

**Badge-ul de pe „Moderare"** (numărul de rapoarte în așteptare) se reîmprospătează la 60s. Nu e
cosmetic: Apple **Guideline 1.2** cere răspuns la raportări în **≤24h**, iar singura măsură a acelui
SLA e lungimea cozii.

### De ce ștergerea GDPR cere să tastezi emailul

E singura acțiune **ireversibilă** din panou. Un `confirm()` simplu se apasă din reflex; tastarea
adresei contului te obligă să te uiți la **care** cont îl ștergi. Costul unui click greșit aici e
un utilizator real, șters definitiv, fără cale de întoarcere.

---

## 3. Autentificarea — de ce în doi pași

```
1. POST /api/v1/admin/login   → TokenPair
2. GET  /api/v1/admin/me      → { id, email, role }
```

Login-ul **nu** folosește `/auth/login` (ruta obișnuită), ci **`/admin/login`**, pentru că aceasta:
- are rate limit **strict** (3/min față de 5/min) — numărul de admini e mic și cunoscut, deci un prag
  mic nu deranjează pe nimeni legitim, dar îngustează fereastra de brute-force pe conturile cele mai valoroase;
- **scrie în jurnalul de audit** (`admin.login`, cu IP).

Al doilea pas există pentru că **`GET /auth/me` nu expune `role`** — panoul n-ar avea din ce să
decidă dacă utilizatorul logat e administrator. `GET /admin/me` fiind în spatele lui `require_admin`,
un `200` e în sine dovada rolului.

La `403`, tokenurile sunt **șterse imediat** — un cont care nu e admin nu rămâne cu o sesiune deschisă în panou.

### Unde stau tokenurile

| Token | Unde | De ce |
|---|---|---|
| Access | **doar în memorie** | Durată scurtă; nu ajunge niciodată pe disc. |
| Refresh | **`sessionStorage`** (`flirt_admin_refresh`) | 🟡 Compromis conștient. |

> **De ce nu un cookie httpOnly** (varianta corectă): backend-ul întoarce și acceptă tokenurile în
> **corpul JSON** și nu setează niciun cookie. Un cookie httpOnly ar cere o schimbare pe backend
> (rămâne ca TODO, notat în cod). `sessionStorage` (nu `localStorage`) limitează măcar expunerea la
> durata tab-ului.

Guardul de rută (`RequireAdmin`) e **doar UX** — redirectează un anonim la `/login`. Poarta reală e
pe server: rolul e citit **din DB la fiecare cerere**, deci un rol retras între două cereri
înseamnă `403` **imediat**, nu la expirarea tokenului.

---

## 4. Stratul HTTP

`src/api/client.ts` — pe `fetch`, fără librărie:

- erori tipizate: `ApiError` (cu status) și `NetworkError` (status `0` = serverul nu răspunde);
- **refresh single-flight** la `401`: o singură cerere de refresh, indiferent câte apeluri au
  primit 401 simultan (altfel, un dashboard cu 5 query-uri paralele ar declanșa 5 rotații de token —
  iar rotația invalidează tokenul anterior, deci 4 din 5 ar eșua și ar deconecta adminul);
- la eșec definitiv emite `auth:expired`, ascultat de `AuthContext`, care trece aplicația în anonim;
- **paginare**: citește `X-Next-Cursor` din header.

`VITE_API_URL` (fallback `http://localhost:8000`) — prefixul `/api/v1` e adăugat de client.

---

## 5. Build și servire în producție

Nu există un runtime separat pentru admin. E **doar fișiere statice**, servite de același nginx.

```
docker compose up  →  serviciul `admin-build` (node:20-alpine, rulează o dată)
                      → scripts/build_admin.sh
                      → npm ci && npm run build
                      → publică în volumul `admin_dist`
                   →  nginx montează `admin_dist:/var/www/admin:ro`
                      și îl servește pe server_name ${ADMIN_DOMAIN}
```

Trei proprietăți care contează:

1. **`build_admin.sh` iese ÎNTOTDEAUNA cu 0.** Dacă build-ul panoului pică, se publică o pagină
   explicativă, iar **API-ul nu e afectat**. nginx nu are `depends_on` pe `admin-build`. Un panou de
   admin stricat nu are voie să doboare aplicația.
2. **Idempotent**: un hash md5 al surselor e salvat în `/dist/.build-hash`; sursă neschimbată = build sărit.
3. **`VITE_API_URL` se injectează la BUILD**, nu la runtime (Vite inline-uiește `VITE_*`). Dacă nu e
   setat în `.env`, devine `https://${DOMAIN}${API_V1_PREFIX}`. Schimbarea domeniului cere **rebuild**, nu doar restart.

### Antete de securitate (nginx, vhost-ul de admin)

HSTS · `X-Content-Type-Options: nosniff` · `X-Frame-Options: DENY` · `Referrer-Policy: no-referrer` ·
CSP: `default-src 'self'; script-src 'self'; frame-ancestors 'none'; connect-src 'self' https://${DOMAIN}`.
`/assets/` sunt cache-uite un an (immutable), `index.html` e `no-store`.

**`/api/` NU e proxat de pe domeniul de admin** — deliberat. API-ul are o singură origine
(`api.flrt.md`), iar panoul vorbește cu ea cross-origin, prin CORS explicit
(`CORS_ORIGINS=https://admin-flirt-paty.flrt.md`). O a doua ușă către API ar fi o a doua suprafață de apărat.

---

## 6. Teste

**19 teste** în **6 fișiere** (Vitest + jsdom + Testing Library):
`client.test.ts` · `LoginPage.test.tsx` · `DashboardPage.test.tsx` · `ModerationPage.test.tsx` ·
`UsersPage.test.tsx` · `EventsPage.test.tsx`.

Helper comun: `src/test/harness.tsx` (`mockFetch`, `renderWithProviders`, `seedAdminSession`, fixture-uri).

```bash
cd admin && npm test
```

---

## 7. Limite cunoscute

| # | Limită |
|---|---|
| 1 | 🟡 **`SubscriptionsPage` nu are teste** — singura pagină fără. |
| 2 | 🟡 Refresh token în `sessionStorage`, nu în cookie httpOnly (vezi §3). Necesită o schimbare pe backend. |
| 3 | ⚠️ **`admin/index.html` încarcă fontul Manrope de la `fonts.googleapis.com`**, dar CSP-ul de producție permite doar `style-src 'self' 'unsafe-inline'` și `font-src 'self' data:` — în producție fontul e **blocat** și se cade pe fontul de sistem. Cosmetic, dar e o inconsistență reală între `index.html` și configul nginx. |
| 4 | ⚠️ `admin/.env.example` spune că `VITE_API_URL` se dă **fără** `/api/v1`, dar `scripts/build_admin.sh` îl compune **cu** `${API_V1_PREFIX}`. Fișierul de exemplu folosește și un domeniu placeholder (`api.exemplu.ro`), nu `api.flrt.md`. |
| 5 | Fără RBAC granular: există doar `user` și `admin`. Coloana `role` e `TEXT` tocmai ca un rol nou (`moderator`) să fie o migrație de **date**, nu o rescriere. |

---

Vezi și: [`README.md`](./README.md) (arhitectura + securitatea backendului de admin) ·
[`api.md`](./api.md) (rutele) · [`../DEPLOYMENT.md`](../DEPLOYMENT.md) (deploy) ·
[`../../PROGRESS.md`](../../PROGRESS.md) (starea proiectului)
