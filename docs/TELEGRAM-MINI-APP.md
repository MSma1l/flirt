# FLIRT ca Telegram Mini App — arhitectură, migrare, rollback

Document de referință pentru migrarea produsului de la aplicație mobilă la Telegram Mini App.
Scris după auditul configurației reale, nu după presupuneri. Ce nu a putut fi verificat e marcat
explicit ca atare.

Punct de plecare: commit `e455db4`, salvat ca tag Git `mobile`.
Branch de lucru: `codex/telegram-mini-app`.

---

## 1. Decizii de arhitectură și motivele lor

### 1.1 Frontend web nou, nu extensia proiectului Expo către web

Aplicația mobilă are deja `react-native-web` instalat și urme de încercări de build web, dar acele
încercări au produs soluții improvizate în configurația de bundling pentru probleme care albeau
pagina. Panoul de admin din același repo e deja un proiect Vite + React, deci precedentul din casă
există. Straturile care s-ar fi reutilizat prin `react-native-web` sunt exact cele care se rescriu
oricum: autentificare socială, plăți native, push, cameră, gesturi cu accelerometru.

Se reutilizează, ca TypeScript pur: funcțiile de apel către API, validările, logica de
compatibilitate și de direcție a swipe-ului, cataloagele de traduceri și tokenii de temă.
Se rescrie interfața, pentru că e scrisă cu primitivele React Native.

### 1.2 Identitatea utilizatorului

Sursa de adevăr e coloana nouă `telegram_user_id`, de tip întreg pe 64 de biți, cu index unic.
Identificatorii Telegram depășesc 32 de biți, deci tipul contează.

Username-ul Telegram nu e folosit niciodată ca identificator: se poate schimba și poate lipsi.

Nu există legare automată între un cont existent și un identificator Telegram nou. Telegram nu
garantează adresa de email sau numărul de telefon, deci o asociere automată ar fi o cale de
preluare de cont. Legarea conturilor existente rămâne un flux explicit, neimplementat în această
lucrare.

### 1.3 Botul e o poartă, nu o aplicație

Botul nu poartă conversații. Rolul lui e să răspundă la comanda de pornire cu un buton care
deschide aplicația. De aceea nu s-a adăugat nicio bibliotecă de bot, doar un client subțire peste
interfața oficială. O bibliotecă ar fi fost greutate fără beneficiu.

---

## 2. Componente, domenii, responsabilități

| Componentă | Domeniu | Responsabilitate | Mediu | Rollback |
|---|---|---|---|---|
| API | `api.flrt.md` | Backend FastAPI, neatins de migrare | producție | Nicio schimbare de domeniu |
| Panou admin | `admin-flirt-paty.flrt.md` | Administrare, neatins | producție | Nicio schimbare |
| Mini App | `miniapp.flrt.md` | Frontend web servit în Telegram | nou | Ștergerea înregistrării DNS |
| Bot Telegram | fără domeniu propriu | Webhook pe API, sub calea `/api/v1/telegram/webhook` | nou | Ștergerea webhookului |
| Aplicație mobilă | folosește `api.flrt.md` | Rămâne în paralel, compatibilitate completă | producție | Neatinsă |

Domeniul rădăcină și `www` nu au înregistrări DNS și nu servesc nimic. Subdomeniul Mini App-ului
e complet liber, deci crearea lui nu poate afecta nimic existent.

API-ul nu se mută și nu se redirecționează. Adresa lui e compilată în build-urile mobile deja
distribuite, deci orice mutare ar rupe aplicațiile din teren.

---

## 3. Fluxul de autentificare

1. Utilizatorul deschide botul și apasă butonul care lansează aplicația.
2. Telegram deschide Mini App-ul și îi oferă datele de inițializare semnate.
3. Frontendul trimite șirul brut către ruta de autentificare Telegram, peste conexiune securizată.
4. Backendul verifică semnătura cu tokenul botului, care nu părăsește niciodată serverul.
5. Backendul verifică vechimea datelor și respinge reutilizarea unei semnături deja consumate.
6. Backendul găsește contul după identificatorul Telegram sau creează unul nou.
7. Backendul emite aceeași pereche de tokenuri ca restul rutelor de autentificare.

### Detaliile de securitate care contează

**Derivarea cheii.** Cheia secretă se obține aplicând funcția de hash cu cheie peste tokenul
botului, folosind o constantă fixă drept cheie. Constanta e cheia, tokenul e mesajul. Inversarea e
greșeala clasică și produce cod care pare să meargă. Există un test dedicat care trimite un hash
calculat invers și cere respingerea.

**Câmpul de semnătură se exclude.** Pe lângă hash, se exclude din șirul de verificare și câmpul de
semnătură alternativă. Dacă ar fi inclus, orice set de date modern trimis de Telegram ar fi respins.

**Datele semnate nu expiră singure.** Rămân valide criptografic la nesfârșit. De aceea verificarea
vechimii nu e opțională, iar pe lângă ea există o evidență a semnăturilor consumate, cu durată de
viață limitată, pe Redis. Fără ea, o captură a datelor ar putea fi reutilizată oricând.

**Versiunea nesigură a datelor nu e dovadă de identitate.** E folosită cel mult pentru a afișa un
nume în interfață cât timp cererea e în zbor.

**Webhookul botului e protejat separat.** Securitatea lui vine exclusiv dintr-un secret pe care
Telegram îl trimite pe un antet, comparat în timp constant. La depășirea limitei de cereri,
webhookul răspunde cu succes și nu procesează, pentru că o eroare ar face Telegram să reîncerce
la nesfârșit.

**Tokenul botului e curățat din jurnale.** Adresa apelată îl conține, deci o eroare de rețea
obișnuită l-ar fi scurs în log.

---

## 4. Migrația bazei de date

O singură migrație, care adaugă pe tabelul de utilizatori două coloane care acceptă valori nule:
identificatorul Telegram, cu index unic, și momentul legării contului.

**Impact:** nul asupra codului existent. Coloanele acceptă valori nule, deci toate conturile create
prin celelalte metode rămân valide. Nu se șterge și nu se modifică nimic. Nu e nevoie de tratarea
duplicatelor, pentru că nu existau date în aceste coloane.

**Reversibilitate:** migrația a fost testată dus-întors pe o bază reală, cu ciclul de aplicare,
anulare și reaplicare. Anularea elimină curat cele două coloane și indexul.

---

## 5. Variabile de configurare noi

Doar numele. Valorile nu apar în acest document și nu trebuie să ajungă în Git.

| Nume | Rol |
|---|---|
| `MINIAPP_DOMAIN` | Numele sub care nginx servește frontendul |
| `MINIAPP_BUILD_DIR` | Directorul de ieșire al buildului |
| `TELEGRAM_BOT_TOKEN` | Tokenul botului. Doar pe server, niciodată în client |
| `TELEGRAM_BOT_USERNAME` | Numele botului, pentru link-uri |
| `TELEGRAM_AUTH_MODE` | Comută între modul de dezvoltare și cel real |
| `TELEGRAM_INIT_DATA_MAX_AGE_SECONDS` | Vechimea maximă acceptată a datelor semnate |
| `TELEGRAM_WEBHOOK_SECRET` | Secretul care autentifică webhookul botului |
| `TELEGRAM_MINIAPP_URL` | Adresa publică a aplicației |
| `CORS_ORIGINS` | Existentă. Trebuie extinsă cu originea Mini App-ului |

Backendul refuză să pornească în producție dacă modul real e activ fără token și fără secret de
webhook, și de asemenea dacă modul de dezvoltare e activ dar botul e configurat, pentru că asta ar
însemna autentificare fără verificare de semnătură.

---

## 6. Politica de securitate a conținutului

Blocul nginx al Mini App-ului diferă intenționat de cel al panoului de admin, iar diferențele sunt
comentate în configurație:

- Aplicația trebuie să poată fi încărcată în cadrul clientului web Telegram, deci restricția care
  interzice orice încadrare e înlocuită cu una care permite exact domeniile Telegram.
- Antetul care interzice complet încadrarea nu e setat pe acest bloc. A fost verificat că nu e
  moștenit de la un nivel superior.
- Se permite încărcarea programului oficial Telegram de pe domeniul lui. Acesta nu se pune în
  bundle, pentru ca actualizările Telegram să ajungă automat.
- Se permit imagini de pe domenii securizate, pentru că avatarele vin de la Telegram.

Restul disciplinei de securitate rămâne: transport securizat obligatoriu, interzicerea ghicirii
tipului de conținut, politica de referință și limitarea numărului de cereri.

---

## 7. Pași de instalare, în ordine

1. Se adaugă înregistrarea DNS de tip A pentru subdomeniul Mini App, către adresa serverului.
2. Se completează variabilele noi în configurația de pe server.
3. Se adaugă originea Mini App-ului în lista de origini permise.
4. Se repornesc serviciile de frontend, de certificate și de proxy. Certificatul se extinde automat
   cu numele nou.
5. Se rulează scriptul de configurare a botului, care înregistrează webhookul și butonul de meniu.
6. Se configurează aplicația în BotFather, cu adresa publică.

---

## 8. Rollback, pentru fiecare schimbare

| Schimbare | Cum se anulează | Efect asupra restului |
|---|---|---|
| Înregistrarea DNS | Se șterge | Niciunul. Cererile pentru un nume necunoscut sunt deja respinse de proxy |
| Blocul nou din proxy | Se revine la versiunea salvată a fișierului | Niciunul. Celelalte blocuri nu au fost atinse |
| Serviciile noi | Se opresc și se elimină | Niciunul. Serviciile existente nu și-au schimbat logica |
| Migrația bazei | Se anulează ultima migrație | Niciunul. Coloanele acceptau valori nule |
| Webhookul botului | Se șterge prin scriptul de configurare | Botul devine inert. API-ul nu e afectat |
| Toată lucrarea | Se revine la tag-ul `mobile` | Starea de dinainte de migrare |

Procedura completă de restaurare a backupului e în arhiva datată de lângă repo, în fișierul de
restaurare.

---

## 9. Ce nu e acoperit de această lucrare

- **Plățile.** Modelul din Telegram e complet diferit de cel nativ. Decizie explicită a
  proprietarului: în afara scopului. Paywall-ul rămâne inactiv în Telegram.
- **Legarea conturilor existente.** Fluxul explicit de confirmare nu e implementat.
- **Notificările.** În Telegram ar veni prin bot, nu prin mecanismul nativ. Nemigrate.
- **Camera și încărcarea de fișiere.** Comportamentul diferă între platformele Telegram și trebuie
  testat pe dispozitive reale înainte de orice promisiune.
- **Retragerea aplicației mobile.** Decizie explicită: rămâne în paralel, cu compatibilitate
  completă. Niciun endpoint nu a fost marcat ca retras și niciunul nu a fost eliminat.
