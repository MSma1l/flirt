# Documentație FLIRT — No Regrets

Documentația tehnică a aplicației de dating **FLIRT** (mobil **React Native + Expo**,
backend **Python FastAPI**, autentificare **JWT**). Structura de mai jos este punctul de
intrare pentru orice cititor nou: pornește de la Overview, apoi Arhitectură, apoi
secțiunile de detaliu (design system, frontend, backend, securitate).

## Cuprins

| Secțiune | Descriere | Link |
|---|---|---|
| **01 — Overview** | Ce este FLIRT, diferențiatorii (Live Events, umor ca parametru), platforme, audiență, lista completă de feature-uri majore. | [`./01-overview.md`](./01-overview.md) |
| **Arhitectura sistemului** | Diagramă de componente end-to-end, fluxuri de date (login+verificare, swipe→match→chat, AI hint, check-in→Passport), comunicare frontend↔backend. | [`./architecture.md`](./architecture.md) |
| **Design System** | Paleta de culori (dark/light), tipografie (Manrope), tokens, reguli de UI. | [`./design-system/colors.md`](./design-system/colors.md) |
| **Frontend** | Aplicația mobilă React Native + Expo: structură, navigare, ecrane, state management (React Query). | [`./frontend/README.md`](./frontend/README.md) |
| **Backend** | API FastAPI: module, modele de date (PostgreSQL + PostGIS), servicii AI, workeri Celery. | [`./backend/README.md`](./backend/README.md) |
| **Securitate** | JWT, verificare de identitate (face-match/liveness), moderare AI, mascare contacte în chat, GDPR/biometrie. | [`./backend/security.md`](./backend/security.md) |

## Surse

Documentația este derivată din:

- **`FLIRT TZ.docx`** — sarcina tehnică completă (specificația funcțională de referință).
- **`flirt_paleta_culori.png`** — paleta de culori oficială (dark & light mode).
- **`FLIRT Prototype (standalone).html`** — prototipul HTML al interfeței.

## Convenții

- Textul documentației este în **română**; numele tehnice rămân în **engleză**.
- Diagramele sunt în format text (ASCII) pentru portabilitate.
