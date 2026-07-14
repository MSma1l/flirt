# Documentație FLIRT — No Regrets

Documentația tehnică a aplicației de dating **FLIRT**: mobil **React Native + Expo**, backend
**Python FastAPI**, panou de admin **React + Vite**, autentificare **JWT (RS256)**.

> **Aplicația e 18+ ONLY.** Segmentul 16–17 din sarcina tehnică inițială (TZ 2.3) a fost **eliminat
> complet** — App Store și Google Play nu acceptă aplicații de dating cu minori. Orice mențiune a
> separării 16–17 / 18+ care ar mai apărea undeva e **obsoletă**.

**Începe de aici:** [`../PROGRESS.md`](../PROGRESS.md) — starea reală a proiectului (ce e gata, ce nu,
ce e amânat și de ce). Restul documentelor descriu **cum** funcționează ce e gata.

## Cuprins

### Stare și operare

| Document | Ce conține |
|---|---|
| [`../PROGRESS.md`](../PROGRESS.md) | **Sursa de adevăr.** ✅ Realizat · 🔧 Modificat față de TZ · 🔜 Urmează · ❌ Amânat. Cu cifre verificate. |
| [`../SECURITY.md`](../SECURITY.md) | Audit de securitate: breșele găsite și cum au fost închise. Guardul de producție, rate-limiting. |
| [`./DEPLOYMENT.md`](./DEPLOYMENT.md) | De la server gol la `api.flrt.md` live. Procedură testată, cu checklist final. |
| [`./INTEGRATIONS.md`](./INTEGRATIONS.md) | Cheile externe reale necesare, per integrare. Ce e gratuit și ce costă. |

### Arhitectură și cod

| Secțiune | Descriere | Link |
|---|---|---|
| **01 — Overview** | Ce este FLIRT, diferențiatorii, audiența, lista de feature-uri cu marcaje ✅/🔜/❌. | [`./01-overview.md`](./01-overview.md) |
| **Arhitectura sistemului** | Componentele reale end-to-end, fluxurile de date, comunicarea frontend↔backend. | [`./architecture.md`](./architecture.md) |
| **Backend** | API FastAPI: structură, endpoint-uri, modele de date, securitate. | [`./backend/README.md`](./backend/README.md) |
| **Frontend (mobil)** | Aplicația Expo: structură, navigare, ecrane, styling. | [`./frontend/README.md`](./frontend/README.md) |
| **Panou de admin** | API-ul `/admin/*` + SPA-ul React: moderare, useri, evenimente, audit. | [`./admin/README.md`](./admin/README.md) |
| **Design System** | Paleta de culori (dark/light), tipografie (Manrope), tokens, componente. | [`./design-system/README.md`](./design-system/README.md) |

### Referință rapidă

| Document | Conținut |
|---|---|
| [`./backend/api-spec.md`](./backend/api-spec.md) | Toate rutele REST, grupate pe domeniu |
| [`./backend/data-models.md`](./backend/data-models.md) | Schema bazei de date (22 tabele) |
| [`./backend/security.md`](./backend/security.md) | JWT, sesiuni, GDPR, mascare contacte, hardening |
| [`./admin/api.md`](./admin/api.md) | Specificația rutelor `/api/v1/admin/*` |
| [`./admin/frontend.md`](./admin/frontend.md) | SPA-ul de admin: pagini, auth, build, servire |
| [`./frontend/navigation.md`](./frontend/navigation.md) · [`./frontend/screens.md`](./frontend/screens.md) · [`./frontend/styling.md`](./frontend/styling.md) | Navigare, ecrane, stiluri |

## Surse

Documentația este derivată din:

- **`FLIRT TZ.docx`** — sarcina tehnică (specificația funcțională de referință).
  ⚠️ TZ nu mai e sursa de adevăr acolo unde realitatea a divergat conștient — vezi
  secțiunea **🔧 MODIFICAT** din [`PROGRESS.md`](../PROGRESS.md).
- **`flirt_paleta_culori.png`** — paleta de culori oficială (dark & light).
- **`FLIRT Prototype (standalone).html`** — prototipul HTML al interfeței.

## Convenții

- Textul documentației este în **română**; numele tehnice rămân în **engleză**.
- Diagramele sunt în format text (ASCII) pentru portabilitate.
- Marcaje: **✅ Implementat** · **🔜 Planificat** · **❌ Amânat** · **🔧 Modificat față de TZ**.
- Când un document descrie ceva ca „planificat", înseamnă că **nu există în cod**. Dacă găsești o
  contradicție între documentație și cod, **codul are dreptate** — semnalează documentul.
