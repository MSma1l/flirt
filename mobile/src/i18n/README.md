# i18n — cum lucrăm cu cele 4 limbi

Interfața FLIRT vorbește **română (`ro`, implicită), rusă (`ru`), ucraineană (`uk`), engleză (`en`)**.

Bibliotecă: **`i18next` + `react-i18next`**, cu **`expo-localization`** pentru limba dispozitivului.

---

## Regula de aur pentru lucrul în paralel

**Un ecran ⇒ un namespace ⇒ fișiere disjuncte.**

Migrezi un ecran? Atingi DOAR `locales/<limbă>/<namespace-ul tău>.json` (×4 limbi) și fișierul ecranului.

**NU ai nevoie să editezi** `resources.ts`, `config.ts` sau `index.ts` — toate cele 14 namespace-uri
există deja, în toate cele 4 limbi (unele goale, `{}`). Sunt pre-create tocmai ca fișierele partajate
să rămână neatinse și să nu ne călcăm pe merge.

Dacă chiar ai nevoie de un namespace nou (rar!), anunță — se adaugă în `config.ts` + `resources.ts`
o singură dată, de o singură persoană.

---

## Namespace-uri: ce zonă unde stă

| Namespace      | Acoperă                                             |
| -------------- | --------------------------------------------------- |
| `common`       | butoane, acțiuni, erori generice, unități — **partajat de toți** |
| `auth`         | `app/(auth)/*` — welcome, login, register, phone     |
| `onboarding`   | `app/(onboarding)/*`                                |
| `feed`         | `app/(tabs)/ankete`, `features/feed`, `features/anketa` |
| `chat`         | `app/(tabs)/mesaje`, `app/chat/[id]`, `features/chat` |
| `profile`      | `app/profile/edit`, `app/passport`, `features/profile` |
| `settings`     | `app/(tabs)/setari`, `app/blocklist`, `features/settings` |
| `events`       | `app/events/*`, `features/events`                   |
| `stories`      | `app/stories/*`, `features/stories`                 |
| `billing`      | `app/paywall`, `features/billing`, `features/subscription` |
| `moderation`   | raportare, blocare, `features/moderation`           |
| `verification` | `app/verify-face`, `features/verification`          |
| `humor`        | `app/humor`, `features/humor`                       |
| `social`       | `app/favorites`, `app/ticket`, `features/social`    |

`common` e singurul scris de mai mulți. Adaugi acolo **doar** ce e cu adevărat generic (ex. „Anulează").
Text folosit de un singur ecran ⇒ namespace-ul lui, nu `common`.

---

## Convenția de numire a cheilor

```
<ecran|componentă>.<element>
```

- `login.title`, `login.submit`, `login.invalidCredentials`
- grupuri generice în `common`: `actions.cancel`, `errors.network`
- **camelCase** pentru fiecare segment; ierarhie de maximum 3 niveluri
- cheia descrie **rolul**, nu textul: `login.submit`, nu `login.autentificareButton`

## Cum adaugi o cheie

1. Scrie-o în `locales/ro/<ns>.json` — româna e sursa de adevăr (tipurile din ea se generează).
2. Adaug-o **în toate cele 4 limbi**. Un test (`__tests__/catalogs.test.ts`) cade dacă lipsește
   dintr-una — nu e opțional.
3. Folosește-o: tipurile apar automat, fără să atingi vreun `.d.ts`.

## Cum migrezi un ecran

Referință completă: **`app/(auth)/login.tsx`** + testul lui. Tiparul:

```tsx
import { useTranslation } from 'react-i18next';

export default function Login() {
  const { t } = useTranslation('auth'); // namespace-ul zonei, o dată, sus

  return <Text>{t('login.title')}</Text>;
}
```

- text din alt namespace ⇒ prefix explicit: `t('common:actions.cancel')`
- **fără** `<I18nextProvider>` și fără setup în teste — instanța e globală, inițializată
  în `app/_layout.tsx` (aplicație) și în `jest.setup.js` (teste)
- nu concatena bucăți traduse (`t('a') + ' ' + t('b')`) — ordinea cuvintelor diferă între limbi.
  Folosește o singură cheie cu interpolare.

## Interpolare

```json
{ "greeting": "Salut, {{name}}!" }
```

```tsx
t('greeting', { name: user.firstName });
```

Variabilele trebuie să fie **identice în toate limbile** — există test care verifică.
`escapeValue` e `false` (React scapă deja la randare), deci diacriticele rămân intacte.

## Pluralizare

Nu scrie `${n} ani` în cod. i18next alege forma după regulile CLDR ale limbii — care **diferă**:

| Limbă | Categorii            | Exemplu (`common:age`)                     |
| ----- | -------------------- | ------------------------------------------ |
| `ro`  | one / few / other    | 1 an · 5 ani · 20 **de** ani               |
| `ru`  | one / few / many / other | 1 год · 3 года · 7 лет                 |
| `uk`  | one / few / many / other | 1 рік · 3 роки · 7 років               |
| `en`  | one / other          | 1 year old · 7 years old                   |

```json
// locales/ro/common.json
"age_one":   "{{count}} an",
"age_few":   "{{count}} ani",
"age_other": "{{count}} de ani"
```

```tsx
t('common:age', { count: user.age }); // → „20 de ani"
```

Româna are **trei** forme, nu două (`20 de ani`, nu `20 ani`) — greșeala clasică.
Rusa și ucraineana au în plus `many`. Testul din `catalogs.test.ts` verifică, prin
`Intl.PluralRules`, că fiecare limbă are exact categoriile cerute.

---

## Limba: detectare, persistare, schimbare

Ordinea la pornire (`initI18n()` din `app/_layout.tsx`):

1. alegerea salvată a userului → 2. limba dispozitivului (dacă e suportată) → 3. **`ro`**

Persistare: `languageStore` → SecureStore pe nativ / `localStorage` pe web — **același mecanism
ca `services/tokenStore`**, fără dependință nouă.

Selector de limbă (UI-ul din Setări îl leagă alt agent):

```tsx
import { useLanguage } from '@/i18n/useLanguage';

const { current, available, labels, setLanguage } = useLanguage();
// current: 'ro' | 'ru' | 'uk' | 'en'
// available: ['ro','ru','uk','en']
// labels: { ro: 'Română', ru: 'Русский', uk: 'Українська', en: 'English' }
await setLanguage('uk'); // schimbă ȘI persistă
```

Numele limbilor sunt **endonime** (fiecare în limba ei) — nu se traduc: un vorbitor de ucraineană
caută „Українська", nu „Ucraineană".

---

## Text care NU vine din cataloagele astea

### Etichete de la server

`GET /profiles/reference` întoarce genuri/statusuri/interese/limbi cu `label_ro`, `label_ru`,
`label_uk`, `label_en`. **Nu le duplica aici** — alegi eticheta după limba activă:

```tsx
const { current } = useLanguage();
const label = item[`label_${current}`] ?? item.label_ro; // fallback pe română
```

Un helper tipat pentru asta ține de zona care consumă `/profiles/reference` (`features/anketa`),
nu de infrastructura i18n.

### Mesaje de eroare din backend

Backendul trimite `detail` **doar în română**. Nu încerca să-l traduci pe client (potrivire pe
șiruri = fragil și se rupe la prima reformulare). Sunt două căi curate — decizie de produs, vezi
raportul:

1. backendul întoarce un **cod** de eroare (`detail_code`), clientul îl mapează la o cheie;
2. backendul localizează după antetul `Accept-Language`.

Până atunci, orice eroare venită de la server rămâne în română, indiferent de limba interfeței.

---

## Ce a rămas (nu e făcut)

- **`src/features/auth/validation.ts`** întoarce mesaje fixe, în română („Introdu o parolă."),
  și e partajat de login / register / phone. Migrarea corectă: funcțiile întorc **chei**
  (`'validation.passwordRequired'`), iar ecranele fac `t(...)`. Trebuie făcută dintr-o mișcare,
  pe toate cele 3 ecrane + `src/utils/validation.ts`.
- Textele din `app.json` (permisiuni iOS/Android) sunt în română. Se localizează prin
  `InfoPlist.strings` per limbă, la build nativ — nu prin i18next.
- 12 din 14 namespace-uri sunt goale: se umplu pe măsură ce se migrează ecranele.

## Verificare

```bash
npx tsc --noEmit          # cheile sunt tipate din locales/ro
npx jest src/i18n         # paritatea celor 4 limbi + plural + interpolare
```
