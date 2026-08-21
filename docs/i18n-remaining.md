# i18n — ce a mai rămas de tradus

Inventarul textelor **încă scrise în cod**, în română, din `mobile/`. Fiecare secțiune din
„Sarcini" e o bucată de lucru **de sine stătătoare**: un namespace, fișierele lui, exemple
și capcanele știute. Poate fi luată direct, fără context suplimentar.

**Stare:** măsurat pe `main` la commit-ul de merge al PR #10 (`312ab98`), după migrarea zonelor
auth, onboarding, feed, chat, moderare, setări, abonamente, passport, bilet și favorite.

**Regula de bază** (din [`mobile/src/i18n/README.md`](../mobile/src/i18n/README.md)):
un ecran ⇒ un namespace ⇒ fișiere disjuncte. Namespace-urile există deja toate, în toate cele
3 limbi — `resources.ts` și `config.ts` **nu se ating**.

---

## Cum se lucrează la o sarcină de aici

1. **Citește întâi** [`mobile/src/i18n/README.md`](../mobile/src/i18n/README.md) — convenția de
   numire, pluralul, interpolarea.
2. **Componentă sau hook** → `useTranslation('<namespace>')`, ca în
   [`app/(auth)/login.tsx`](<../mobile/app/(auth)/login.tsx>).
3. **Modul care NU e componentă** (helper, serviciu, dicționar de mesaje) → citește din instanța
   globală, **la fiecare apel**, nu la încărcarea modulului. Două precedente în cod:
   - [`src/utils/dialog.ts`](../mobile/src/utils/dialog.ts) — butonul de anulare al dialogurilor;
   - [`src/features/billing/iap.ts`](../mobile/src/features/billing/iap.ts) — dicționarul de mesaje
     de achiziție, prin `MESSAGE_KEY` + `msg()`.

   Motivul: dacă traducerea se citește o singură dată, la import, prima folosire îngheață limba
   pentru toată sesiunea.
4. **Cheile** se scriu în toate cele 3 limbi (`locales/{ro,ru,en}/<ns>.json`). Româna e sursa de
   adevăr — tipurile se generează din ea. `__tests__/catalogs.test.ts` cade dacă lipsește una.
5. **Testul** — un bloc `describe('i18n')` la finalul testului ecranului, după tiparul din
   [`app/(auth)/__tests__/login.test.tsx`](<../mobile/app/(auth)/__tests__/login.test.tsx>):
   aserțiunile românești rămân neschimbate, iar cele noi verifică faptul că textul **urmează**
   limba activă. Fără ele, o migrare care nu traduce nimic trece testele.
6. **Verificare:** `npx tsc --noEmit` (cheile sunt tipate — o cheie greșită pică aici) și `npx jest`.

### Trei reguli care se uită ușor

| Regulă | De ce |
|---|---|
| Numele de produs **nu se traduc**: `FLIRT`, `Flirt Passport`, `Flirt Party`, `No Regrets` | Sunt brand. Când apar într-o frază traductibilă, fraza se traduce, numele rămâne literal în fiecare limbă. |
| Numărul se dă prin `count`, nu prin `${n}` | Româna are **trei** forme (1 intrare / 3 intrări / 21 **de** intrări), rusa patru. Vezi `chat:list.unread` și `profile:passport.discountCard.entriesLeft`. |
| Nu se concatenează bucăți traduse | Ordinea cuvintelor diferă între limbi. O singură cheie cu interpolare. |

---

## Sarcini

### 1. Story-uri — namespace `stories` · ≈40 de texte

Namespace-ul are deja `bar.*` (bara de story-uri de deasupra feed-ului). Restul zonei e nemigrat.

| Fișier | Exemple |
|---|---|
| `app/stories/[userId].tsx` | „Nu am putut încărca poveștile.", „Nu există povești de afișat.", „Șterge povestea", a11y „Povestea anterioară" / „Povestea următoare", două `alertMessage` |
| `app/stories/new.tsx` | „Permisiune necesară", „Poză respinsă", „Descriere (opțional)", „Adaugă un text…", „Publică", „Refă" |
| `src/features/stories/StoryCameraScreen.tsx` | „Permite acces la cameră", „Alege din galerie", „Fă o poză", a11y „Comută camera" |
| `src/features/stories/StoryReplyBar.tsx` | „Răspunde-i lui {{name}}…", a11y „Reacționează cu {{emoji}}", „Trimite răspunsul" |
| `src/features/stories/storyLimits.ts` | dicționar de 9 mesaje: galerie/cameră refuzată, upload eșuat, publicare eșuată |

**Capcană:** `storyLimits.ts` e exact tiparul din `iap.ts` — un obiect de mesaje într-un modul care
nu e componentă. Se migrează la fel: chei în catalog + o funcție care le citește la apel.

---

### 2. Verificare prin selfie — namespace `verification` · ≈19 texte

**Singurul namespace încă gol** din cele 14.

| Fișier | Exemple |
|---|---|
| `app/verify-face.tsx` | textul introductiv („Confirmă că profilul îți aparține printr-un selfie rapid…"), „Poziționează-ți fața în cadru", „Fă un selfie și verifică", „Selfie-ul este folosit doar pentru verificare și nu apare în profilul tău." |
| `src/features/verification/messages.ts` | 8 mesaje pe coduri de eroare (`no_face`, `too_large`, `rate_limited`, …) + 3 despre accesul la cameră |

**Capcană:** `messages.ts` mapează **coduri de la server** la texte. Codul rămâne cheia; doar textul
trece în catalog. Structura e deja bună pentru asta.

---

### 3. Evenimente — namespace `events` · ≈9 texte

Namespace-ul are deja `detail.*` (ecranul unui eveniment). Lipsesc lista și harta.

| Fișier | Exemple |
|---|---|
| `app/events/index.tsx` | „Nu am putut încărca evenimentele.", „Niciun eveniment momentan — revino curând!", a11y „Deschide {{title}}", „Deschide Flirt Passport" |
| `src/features/events/EventMap.tsx` | „Locație indisponibilă", a11y „Harta locației: {{title}}" |

**Capcană:** `EventMap` generează HTML pentru Leaflet cu `<html lang="ro">` codificat în șir.
Atributul trebuie să urmeze limba activă odată cu textele.

---

### 4. Validare — 3 fișiere · ≈30 de texte

Semnalat deja în `src/i18n/README.md` ca sarcină separată, fiindcă atinge mai multe ecrane deodată.

| Fișier | Cine îl folosește | Exemple |
|---|---|---|
| `src/utils/validation.ts` | anketă, chat, story-uri, moderare, setări | „Introdu data nașterii.", „Raza trebuie să fie între {{min}} și {{max}} km.", „Textul nu poate conține marcaje HTML." |
| `src/features/anketa/validation.ts` | wizardul de anketă, setări | „Introdu numele tău.", „Alege genul.", „Vârsta minimă nu poate fi sub {{min}} ani (aplicația este 18+)." |
| `src/features/photos/validation.ts` | anketă, editor de profil, story-uri | „Tip de fișier nepermis…", „Poza are {{size}}, peste limita de {{max}}…", „Adaugă cel puțin {{min}} poze ca să continui" |

**Tiparul cerut** (stabilit deja de `src/features/auth/validation.ts`): funcțiile întorc **chei**,
ecranele fac `t(...)`, iar REGULA (regex, praguri) rămâne în modulul central, expusă ca predicate
(`looksLikeEmail`, `hasHtml`) — ca mesajul să fie ales de cine îl afișează.

**De decis la preluare:** `photos/validation.ts` nu are un namespace evident (pozele apar în
onboarding ȘI în editorul de profil). Recomandare: `profile`, fiindcă acolo se gestionează pozele
în timp; alternativa e `common`.

---

### 5. Mărunțișuri vizibile · ≈20 de texte

Se pot face separat sau într-un singur pas — nu depind unul de altul.

| Fișier | Namespace | Exemple |
|---|---|---|
| `app/(tabs)/_layout.tsx` | `common` sau per zonă | „Ankete", „Mesaje", „Setări" — **fiecare de două ori**: `title` și `tabBarAccessibilityLabel` |
| `src/components/ui/BackButton.tsx` | `common` | „Înapoi" — cheia **`common:actions.back` există deja**, e o singură linie |
| `src/features/ads/AdInterstitial.tsx` | `feed` | „Poți închide în {{count}} secunde" (plural!), a11y „Închide reclama", „Deschide reclama" |
| `src/features/push/usePushPermissionPrompt.ts` | `settings` | dialogul „Te anunțăm când primești un mesaj?", „Da, anunță-mă", „Nu acum" |
| `src/features/push/pushService.ts` | `settings` | **doar** numele canalului Android: „Mesaje și potriviri" — se vede în setările sistemului de pe telefon |
| `src/features/anketa/components/CountryPickerField.tsx` | `feed` (vezi nota) | „Alege țara", „Naționalitate", „Caută țara...", „Nicio țară găsită." |

**Notă:** după tabelul din `src/i18n/README.md`, `features/anketa` ține de `feed`. Componenta apare
însă doar în wizardul de onboarding, deci `onboarding` ar fi la fel de defensabil — alege una și
fii consecvent.

---

## Nu se traduce — și de ce

Sunt lucruri pe care un scanner le raportează, dar care **nu** sunt text de interfață. Lăsate
deliberat așa.

| Fișier | Ce e acolo | De ce rămâne |
|---|---|---|
| `src/features/navigation/serverGate.ts` | „Profilul tău nu este complet." ș.a. | **Contract cu backendul**, nu mesaje de afișat: se compară cu `detail` dintr-un 403. Userul vede traducerile din `feed`. E scris în fișier. |
| `src/config.ts` | „EXPO_PUBLIC_API_URL lipsește din build-ul de producție…" | `throw` la pornire, pentru dezvoltator. Nu ajunge la user. |
| `theme/ThemeProvider.tsx` | „useTheme trebuie folosit în interiorul \<ThemeProvider\>" | Eroare de programare. |
| `src/features/auth/socialAuth.ts` | „Autentificarea Google a fost anulată." ș.a. | Ecranul nu afișează `message`: `welcome.tsx` mapează eroarea prin `socialErrorKey(err)` la o cheie din `auth`. |
| `src/features/push/pushService.ts` | „push-ul nu funcționează pe simulator…", „permisiunea de notificări nu este acordată." | Mesaje de log / diagnostic. **Excepție:** numele canalului Android — vezi sarcina 5. |
| `src/i18n/config.ts` | „Română", „Русский", „English" | **Endonime.** Un vorbitor de rusă caută „Русский", nu „Rusă". Documentat în README. |
| `eventsApi.ts`, `ticketsApi.ts`, `subscriptionApi.ts`, `humorApi.ts` | — | Fals pozitiv al scanerului: sunt chei de obiect la maparea răspunsului, nu text. |

### Text care vine de la server

Două categorii, ambele descrise în `src/i18n/README.md`:

- **Etichetele din `/profiles/reference`** (genuri, statusuri, interese, limbi) vin cu
  `label_ro/ru/en` — se alege după limba activă, nu se duplică în cataloage.
- **`detail`-ul erorilor de backend** vine **doar în română**. Nu se traduce pe client prin
  potrivire pe șiruri. Precedentul rezolvat corect: **catalogul de planuri** din
  `app/paywall.tsx` — serverul trimite titlu și beneficii în română, dar `code`-ul planului e
  stabil, deci ecranul traduce **după cod**, cu textele serverului ca ultimă soluție pentru un cod
  necunoscut. Același truc merge oriunde serverul trimite text + un cod stabil.

---

## Caz aparte: `src/features/anketa/countries.ts`

26 de nume de țări cu diacritice („Africa de Sud", „Coreea de Sud", „Elveția") — dintr-o listă de
~200.

**Nu e o sarcină de i18n obișnuită.** Sunt **date**, nu texte de interfață; 200 × 3 limbi în catalog
e o listă care se învechește. Varianta uzuală e `Intl.DisplayNames` cu limba activă, cu lista de
coduri ISO în cod. E o decizie de produs (ce se face pe dispozitivele fără ICU complet), nu o
migrare mecanică — de discutat înainte de a fi luată.

---

## Cum se regenerează lista

Nu există un script în repo; inventarul de mai sus s-a obținut cu un scaner ad-hoc care:

1. parcurge `mobile/{app,src,theme}`, sărind peste `__tests__`, `locales`, `node_modules`;
2. **elimină comentariile** (în proiect sunt în română din principiu — altfel raportul e inutilizabil);
3. reține șirurile și textul JSX care conțin diacritice românești sau cuvinte românești frecvente;
4. filtrează căi, chei, URL-uri, culori și identificatori.

Pentru o verificare rapidă „mai există text nemigrat în fișierul X?", un grep e suficient:

```bash
cd mobile
grep -nE "(accessibilityLabel|accessibilityHint|placeholder|label)=[\"'][^\"']" <fisier>
grep -nE "['\"][A-ZĂÎȘȚÂ][^'\"]*[ăîâșț][^'\"]*['\"]" <fisier> | grep -v "t('"
```

---

## Progres

| Namespace | Stare |
|---|---|
| `common`, `auth`, `onboarding`, `feed`, `chat`, `profile`, `settings`, `billing`, `moderation`, `social`, `humor` | ✅ ecranele principale migrate |
| `stories` | 🔧 doar bara de story-uri |
| `events` | 🔧 doar ecranul unui eveniment |
| `verification` | ❌ gol |

Textele rămase sunt cele din „Sarcini": ≈118 de șiruri, în 18 fișiere.
