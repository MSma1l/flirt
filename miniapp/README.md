# FLIRT — Telegram Mini App

Frontend web pentru FLIRT, rulat în interiorul Telegram. Vite + React 19 +
TypeScript strict, aceeași configurație ca panoul `admin/`.

Nu e o extensie web a aplicației Expo: componentele native (gesturi, cameră,
plăți) se rescriu oricum pentru DOM. Ce se REUTILIZEAZĂ e logica pură din
`mobile/`, importată direct prin alias — fără copii de ținut în sincron.

## Rulare locală

```bash
cd miniapp
npm install
npm run dev          # http://localhost:5175
```

Alte comenzi:

```bash
npm run typecheck    # tsc --noEmit
npm test             # vitest run
npm run build        # typecheck + build de producție în dist/
npm run preview      # servește dist/ local
```

## Variabile de mediu

Se pun în `miniapp/.env.local` (vezi `.env.example`). Numele, fără valori:

| Variabilă      | Obligatorie | Notă                                                        |
| -------------- | ----------- | ----------------------------------------------------------- |
| `VITE_API_URL` | la build de producție | Trebuie să fie HTTPS. Lipsa ei sau o adresă HTTP opresc pornirea cu o eroare clară — Telegram servește Mini App-ul peste HTTPS, iar cererile HTTP ar fi blocate ca „mixed content". În dezvoltare, dacă lipsește, se cade pe backendul local. |

## Testare în afara Telegram

Aplicația pornește și într-un browser obișnuit: puntea din `src/telegram/`
întoarce valori implicite în loc să arunce, deci tema, marginile de siguranță și
butoanele native devin no-op-uri.

Ce NU merge în browser: autentificarea. Fără client Telegram nu există
`initData`, deci nu există dovadă de identitate — ecranul arată explicit „Deschide
din Telegram", fără buton de reîncercare (ar eșua garantat). Pentru a testa
fluxul complet ai nevoie de un client Telegram real, care încarcă pagina peste
HTTPS: pornește `npm run dev`, expune portul 5175 printr-un tunel HTTPS și pune
adresa ca URL de Mini App la botul de test în BotFather.

## Ce se reutilizează din aplicația mobilă

Importate DIRECT din `mobile/`, prin alias-uri (`vite.config.ts` + `tsconfig.json`):

| Fișier                                  | Rol                                              |
| --------------------------------------- | ------------------------------------------------ |
| `mobile/src/features/feed/feedApi.ts`    | cererile `/feed`, `/feed/swipe`, `/feed/undo`     |
| `mobile/src/features/feed/swipeDirection.ts` | pragurile și regula de dominanță a axelor     |
| `mobile/src/features/feed/compat.ts`     | culoarea și eticheta de compatibilitate           |
| `mobile/src/features/feed/types.ts`      | tipurile feed-ului                                |
| `mobile/src/i18n/config.ts`, `resources.ts` + `locales/` | cataloagele de traduceri (4 limbi) |
| `mobile/theme/colors.ts`                 | paleta oficială                                   |

Alias-ul `@/services/api` e mapat pe clientul HTTP al Mini App-ului, ca fișierele
importate din Expo să primească instanța axios de aici, nu pe cea care ar trage
`expo-constants`.

## Ce e rescris

- interfața (DOM în loc de React Native), inclusiv cardul de profil și deck-ul;
- gesturile: evenimente de pointer în loc de `PanResponder`;
- tema: variabile CSS, cu parametrii Telegram peste paleta produsului;
- scara tipografică: `mobile/theme/typography.ts` importă `react-native`, deci
  valorile sunt transcrise în `src/theme/tokens.ts`. **Singura duplicare de
  tokeni din proiect** — dacă scara se schimbă pe mobil, se schimbă și aici.

## Decizii care se explică greu din cod

- **Sesiunea nu se persistă.** Nici access, nici refresh token nu ajung în
  `localStorage`. WebView-ul Telegram își poate reseta stocarea între deschideri,
  iar `initData` e disponibil la fiecare pornire — deci reautentificarea costă o
  cerere și nu cere nimic utilizatorului. Detalii în `src/api/tokenStore.ts`.
- **`initDataUnsafe` nu e dovadă de identitate.** E folosit doar pentru numele
  afișat instant și pentru limbă. Identitatea vine din `initData` brut, verificat
  de backend pe `POST /api/v1/auth/telegram`.
- **Accentul de brand nu se schimbă după tema Telegram.** Fundalul, suprafețele
  și textul urmează clientul; roz-ul FLIRT rămâne al nostru.

## Ce NU e implementat

Schelărie, nu produs complet. Lipsesc, față de aplicația nativă: chat, evenimente,
stories, abonamente, anketa de onboarding, verificarea facială, reclamele
interstițiale, butoanele de favorit/raportare/blocare de pe card, sheet-ul de
mesaj la like și selectorul de limbă. Deck-ul trimite `like` direct, fără mesaj
de deschidere.
