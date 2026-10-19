# Politica de confidențialitate și de prelucrare a datelor cu caracter personal FLIRT

Versiunea {{version}} · în vigoare din {{effective_date}}

## Pe scurt

- Prelucrăm datele dumneavoastră doar ca să funcționeze FLIRT: contul, profilul, recomandările de profiluri, conversațiile, evenimentele Flirt Party, biletele și programul de fidelitate Flirt Passport.
- FLIRT este destinat exclusiv persoanelor de **18 ani sau mai mult**.
- **Nu vindem** datele dumneavoastră. Nu le transmitem rețelelor de publicitate și nici brokerilor de date. Nu folosim instrumente de analiză sau trackere publicitare.
- Serverele și fișierele media se află într-un centru de date din **Chișinău, Republica Moldova**.
- Funcțiile AI sunt **dezactivate implicit**. Pornesc doar dacă le activați dumneavoastră.
- Din aplicație vă puteți **descărca datele**, puteți **opri notificările** și vă puteți **șterge contul**.
- Aveți dreptul să depuneți o plângere la Centrul Național pentru Protecția Datelor cu Caracter Personal ([www.datepersonale.md](https://www.datepersonale.md)).

## 1. Cadrul legal

Politica respectă **Legea nr. 195/2024 privind protecția datelor cu caracter personal**. Legea a fost adoptată la 25 iulie 2024, a fost publicată în Monitorul Oficial al Republicii Moldova nr. 367-369 din 23 august 2024 (art. 574) și se aplică de la **23 august 2026**. Ea înlocuiește Legea nr. 133/2011 și transpune Regulamentul (UE) 2016/679 (GDPR).

Când scriem „art.” fără alte precizări, ne referim la articolele Legii nr. 195/2024. Dacă vă aflați în Uniunea Europeană sau în Spațiul Economic European, se aplică direct și GDPR. Articolele GDPR au aceeași numerotație.

Politica vă oferă informațiile prevăzute la art. 12–14: cine prelucrează datele, ce date, în ce scop, în baza cărui temei, cui le transmitem, cât timp le păstrăm și ce drepturi aveți.

## 2. Operatorul și datele de contact

Operatorul datelor cu caracter personal prelucrate prin FLIRT este:

| | |
|---|---|
| **Denumire** | {{operator_name}} |
| **IDNO** | {{operator_idno}} |
| **Adresă** | {{operator_address}} |
| **E-mail pentru protecția datelor** | [{{contact_email}}](mailto:{{contact_email}}) |
| **Responsabil cu protecția datelor (art. 37–39) / persoană de contact** | {{dpo_contact}} |

Ne puteți scrie la această adresă pentru orice întrebare despre datele dumneavoastră sau pentru a vă exercita drepturile.

## 3. La ce se aplică

Politica se aplică prelucrării datelor prin:

- aplicația FLIRT ca Telegram Mini App (miniapp.flrt.md) și botul Telegram @flrt_party_bot;
- aplicația mobilă FLIRT (iOS și Android), acolo unde este disponibilă;
- serverele și interfața de programare (API, api.flrt.md) care deservesc aceste aplicații;
- evenimentele Flirt Party organizate de operator: vânzarea biletelor, accesul la intrare și programul Flirt Passport.

Politica nu acoperă serviciile terților, de exemplu Telegram, magazinele de aplicații sau banca dumneavoastră. Acestea au propriile politici de confidențialitate.

### Termeni folosiți

| Termen | Ce înseamnă |
|---|---|
| **Date cu caracter personal** | orice informație despre o persoană fizică identificată sau identificabilă |
| **Prelucrare** | orice operațiune cu date: colectare, stocare, afișare, transmitere, ștergere etc. |
| **Operator** | cel care stabilește scopurile și mijloacele prelucrării (noi) |
| **Persoană împuternicită** | un furnizor care prelucrează date în numele și din instrucțiunile operatorului |
| **Categorii speciale de date** | date sensibile, de exemplu cele care dezvăluie orientarea sexuală sau datele biometrice (art. 9) |
| **Profilare (crearea de profiluri)** | evaluarea automată a unor aspecte personale, de exemplu compatibilitatea cu alte persoane |

## 4. Ce date prelucrăm și de unde le avem

| Categorie | Ce date | Sursa |
|---|---|---|
| **Cont Telegram** | identificatorul de utilizator Telegram și limba interfeței Telegram (ro/ru/en). Pentru aceste conturi se generează și o adresă de e-mail tehnică, care nu vă aparține și nu e folosită pentru comunicare. | Telegram, la deschiderea Mini App-ului |
| **Date Telegram folosite doar pe dispozitiv** | prenumele, numele și numele de utilizator Telegram. Mini App-ul le folosește pe telefonul dumneavoastră: completează automat numele în profil și în comanda de bilet. **Serverul nu le stochează**. | Telegram |
| **Fotografia de profil Telegram (avatar de rezervă)** | la fiecare intrare prin Telegram preluăm fotografia dumneavoastră de profil Telegram, o descărcăm și **o stocăm pe serverul nostru** (JPEG de cel mult 640 px, fără metadate), împreună cu adresa ei de origine și data ultimei verificări. O afișăm persoanelor cu care aveți o conversație (lista conversațiilor, antetul conversației, profilul deschis din conversație) **numai cât timp nu aveți fotografii proprii în FLIRT**. Nu apare în recomandări și nu devine fotografie de profil. | Telegram: datele de lansare ale Mini App-ului sau Bot API, în limita setărilor de confidențialitate Telegram |
| **Alte metode de autentificare** (doar aplicația mobilă, când sunt activate) | e-mailul și parola (parola e stocată numai ca hash Argon2), numărul de telefon pentru codul SMS, identificatorul Google sau Apple | dumneavoastră / Google / Apple |
| **Starea contului** | rolul, data creării, ultima activitate, eventuala suspendare și motivul ei, cererea de ștergere | sistemul |
| **Profil** | numele afișat, data nașterii (altora le arătăm doar vârsta), genul, înălțimea, naționalitatea, limbile vorbite, descrierea (max. 500 de caractere), interesele, statutul de întâlniri (ce căutați), insigna „verificat” | dumneavoastră |
| **Fotografii și povești** | 2–9 fotografii de profil; poveștile (stories), cu fotografie sau video și descriere | dumneavoastră |
| **Localizare** | orașul (obligatoriu), strada (opțional) și coordonatele obținute din ele prin geocodare. **Nu folosim localizarea GPS a dispozitivului** în Mini App. | dumneavoastră / serviciul de geocodare |
| **Preferințe** | genurile care vă interesează, intervalul de vârstă, raza de căutare, ascunderea profilului, setările de notificare, activarea funcțiilor AI | dumneavoastră |
| **Testul de umor** (doar când este activat, vezi secțiunea 8) | aprecierile dumneavoastră la glume („amuzant” / „nu”) și profilul de umor calculat din ele (7 tipuri de umor) | dumneavoastră / calcul automat |
| **Activitate socială** | aprecierile și respingerile, super-aprecierile (cu mesajul atașat, dacă există), potrivirile (match-urile), favoritele, blocările | dumneavoastră |
| **Vizualizări de profil și centrul de activitate** | când cineva vă apreciază sau vă respinge profilul în recomandări ori vă deschide profilul (de exemplu din conversație), înregistrăm cine a văzut, al cui profil și ziua: un singur rând pe vizitator, pe profil și pe zi. Păstrăm și momentul până la care v-ați citit activitatea (citit / necitit). | dumneavoastră și ceilalți utilizatori / sistemul |
| **Conversații** | mesajele text, fotografiile, video-urile și mesajele vocale trimise; reacțiile; starea de citire; metadatele fișierelor (dimensiune, durată, rezoluție). Mesajele vocale sunt convertite pe serverul nostru în format AAC/M4A, ca să poată fi ascultate pe orice dispozitiv; conversia nu implică terți. | dumneavoastră și interlocutorii |
| **Raportări** | raportările trimise de dumneavoastră sau despre dumneavoastră: categorie, notă, referință la conversație, stare | utilizatori / moderatori |
| **Evenimente și fidelitate** | participarea la evenimente („merg”), biletul (cod afișat ca QR), scanarea la intrare, ștampilele Flirt Passport, nivelul de fidelitate și reducerile, codurile de invitație folosite | dumneavoastră / personalul de la intrare |
| **Comenzi de bilete** | numele complet, telefonul, e-mailul, mesajul dumneavoastră, numărul de bilete, suma, metoda de plată (plată instant MIA sau transfer bancar), referința și descrierea plății, **dovada plății** (imagine sau PDF, care poate conține date bancare), starea comenzii, notele administratorului, momentele deciziei și ale intrării | dumneavoastră / administratori |
| **Abonamente** (aplicația mobilă, când sunt activate) | planul, identificatorii tranzacției, data expirării, chitanța de la App Store / Google Play sau de la procesatorul de plăți | magazinul de aplicații / procesatorul de plăți |
| **Notificări** | permisiunea acordată botului de a vă scrie în Telegram, cele patru comutatoare de notificare; în aplicația mobilă, tokenul de notificări push și platforma | dumneavoastră / Telegram |
| **Date tehnice** | adresa IP (în jurnalele de acces doar trunchiată), tipul browserului/aplicației, identificatorul cererii, jurnalele de erori, contoarele temporare de limitare a abuzurilor | dispozitivul dumneavoastră |
| **Evidențe** | consimțămintele acordate (document, versiune, dată și oră, IP, agent utilizator); jurnalul acțiunilor administrative ale echipei | sistemul |

**Nu primim și nu stocăm datele cardului dumneavoastră bancar.** Plata biletelor se face din aplicația băncii dumneavoastră (MIA sau transfer). Abonamentele din aplicația mobilă se plătesc prin magazinul de aplicații.

**Nu vă cerem** date despre sănătate, religie, convingeri politice, origine etnică sau antecedente penale.

## 5. Scopurile, temeiurile legale și termenele

Prelucrăm datele numai dacă avem un temei prevăzut la art. 6 (pentru categoriile speciale, și art. 9):

| Scop | Date folosite | Temei legal | Cât păstrăm |
|---|---|---|---|
| Crearea și administrarea contului, autentificarea | cont, stare cont, date tehnice | executarea contractului (Termenii de utilizare), art. 6 | cât există contul (vezi secțiunea 12) |
| Afișarea profilului, recomandări, aprecieri, potriviri | profil, fotografii, localizare, preferințe, test de umor (când este activat), activitate socială | executarea contractului, art. 6 | cât există contul |
| Fotografia Telegram ca avatar de rezervă în conversații | fotografia de profil Telegram | executarea contractului (conversațiile) și interes legitim (să vă recunoască interlocutorii cât timp nu aveți fotografii proprii), art. 6 | cât există contul; se înlocuiește când schimbați fotografia în Telegram și se șterge când nu mai este disponibilă acolo (vezi secțiunea 12) |
| Centrul de activitate: numărul vizualizărilor de profil, statistici (aprecieri, super-aprecieri, respingeri, potriviri), lista celor care v-au apreciat sau cu care aveți potrivire | vizualizări de profil, activitate socială | executarea contractului, art. 6; înregistrarea vizitelor dumneavoastră la profilurile altora: interes legitim, art. 6 | cât există contul (vezi secțiunea 12) |
| Recomandări după gen și genurile care vă interesează (pot dezvălui orientarea sexuală) | gen, genurile care vă interesează, statut de întâlniri | **consimțământ explicit**, art. 6 și art. 9 (vezi secțiunea 6) | cât există contul sau până vă retrageți consimțământul |
| Conversații și povești | conversații, povești | executarea contractului, art. 6 | până la ștergerea mesajului / poveștii sau a contului |
| Evenimente, bilete, intrare, Flirt Passport | evenimente, comenzi, fidelitate | executarea contractului, art. 6 | vezi secțiunea 12 |
| Evidența contabilă a vânzării biletelor | comenzi (anonimizate după ștergerea contului), dovezi de plată | obligație legală (Legea contabilității și raportării financiare nr. 287/2017), art. 6 | dovezile: {{proof_retention_years}} ani; evidența anonimizată: conform legii |
| Notificări Telegram despre mesaje, aprecieri, potriviri și povești | identificator Telegram, prenumele expeditorului, previzualizarea mesajului | consimțământ (permisiunea dată botului în Telegram) și executarea contractului, art. 6; le puteți opri oricând | nu le stocăm după trimitere |
| Funcții AI (sugestii de mesaje, explicația „chimiei”) | vezi secțiunea 7 | **consimțământ** (activare în Setări), art. 6 | nu stocăm cererile; memorie temporară de 5 minute |
| Verificarea facială (momentan indisponibilă) | selfie, prima fotografie de profil | **consimțământ explicit**, art. 9 | selfie-ul nu se stochează; se păstrează doar rezultatul |
| Siguranța comunității: moderarea fotografiilor, mascarea datelor de contact, raportări, blocări, suspendări | fotografii, mesaje, raportări, stare cont | interes legitim, art. 6 | raportările se păstrează și după ștergerea contului |
| Securitatea serviciului: jurnale, limitarea abuzurilor, prevenirea fraudei | date tehnice | interes legitim, art. 6 | jurnalele: max. {{log_retention_days}} de zile |
| Anunțuri proprii între profiluri (de exemplu, promovarea evenimentelor) | genul și vârsta, pentru alegerea anunțului potrivit | interes legitim, art. 6 | nu se creează un istoric pe utilizator |
| Copii de siguranță (backup) | toate datele din baza de date și fișierele media | interes legitim, art. 6 | {{backup_days}} zile |
| Evidența consimțămintelor și a cererilor privind drepturile | evidențe | obligație legală (obligația de a demonstra consimțământul), art. 6 | pe durata contului; după ștergere, fără IP și agent utilizator |
| Răspunsul la cererile legale ale autorităților | datele cerute de lege | obligație legală, art. 6 | cât cere legea |
| Apărarea unor drepturi în justiție | raportări, evidențe | interes legitim, art. 6 | până la expirarea termenelor de prescripție |

**Interesul nostru legitim** este funcționarea sigură și corectă a serviciului, protecția utilizatorilor față de abuzuri și fraudă și promovarea propriilor evenimente. Ne puteți cere oricând evaluarea făcută pentru acest temei. Vă puteți opune acestor prelucrări (secțiunea 13).

**Fără datele obligatorii** (vârstă, gen, oraș, fotografii) nu putem crea profilul și nu vă putem recomanda persoane. Datele opționale (strada, înălțimea, descrierea, interesele etc.) le completați doar dacă vreți.

## 6. Categorii speciale de date (date sensibile)

**Orientarea sexuală.** Genul dumneavoastră, genurile care vă interesează și statutul de întâlniri pot dezvălui indirect orientarea sexuală sau aspecte ale vieții intime. Acestea sunt categorii speciale de date (art. 9). Le prelucrăm **numai pe baza consimțământului dumneavoastră explicit**, exprimat prin Acordul privind prelucrarea datelor cu caracter personal la intrarea în aplicație, și **numai** ca să vă recomandăm profiluri potrivite. Altor utilizatori nu le afișăm genurile care vă interesează. Nu folosim aceste date pentru publicitate.

Puteți modifica oricând aceste preferințe în profil. Vă puteți retrage consimțământul prin ștergerea contului, pentru că fără aceste date nu vă putem recomanda persoane.

**Date biometrice.** Verificarea facială compară automat un selfie cu fotografia de profil, ca să confirme că profilul vă aparține. Aceasta este o prelucrare de date biometrice. Are loc numai cu un consimțământ explicit, separat și opțional. **Selfie-ul nu se stochează**. Păstrăm doar rezultatul (profil verificat sau nu). **În prezent funcția este indisponibilă.** Vă vom cere consimțământul în momentul în care o veți folosi.

**Ce publicați dumneavoastră.** Vă rugăm să nu includeți date sensibile despre dumneavoastră sau despre alții în descriere, povești sau mesaje (de exemplu despre sănătate sau religie). Dacă o faceți, acestea devin vizibile persoanelor cărora le sunt adresate.

## 7. Funcții opționale

| Funcție | Implicit | Ce date folosește | Cum o controlați |
|---|---|---|---|
| **Sugestii de mesaje AI** | **oprită** | ultimele cel mult 8 mesaje din conversație, fiecare trunchiat la 400 de caractere și marcat doar „eu” / „interlocutor”. **Fără nume, identificatori, date sau fotografii**. Datele de contact sunt mascate înainte de trimitere. | Setări → funcții AI |
| **Explicația „chimiei” (AI)** | **oprită** | scorul de compatibilitate, interesele, limbile și statutele comune, distanța aproximativă în cuvinte (de exemplu „la aproximativ 12 km”). Fără nume și fotografii. | Setări → funcții AI |
| **Notificări prin botul Telegram** | botul vă scrie numai după ce îi permiteți acest lucru în Telegram | prenumele persoanei care v-a scris sau v-a apreciat și o previzualizare de cel mult 80 de caractere a mesajului (cu datele de contact mascate), transmise prin serverele Telegram | Setări → notificări: patru comutatoare (mesaje, aprecieri, potriviri, povești) |
| **Notificări push** (aplicația mobilă) | doar cu permisiunea telefonului | tokenul dispozitivului | setările telefonului / aplicației |
| **Verificarea facială** | indisponibilă | selfie, prima fotografie de profil | consimțământ separat, retras oricând din „Confidențialitate și date” |

Funcțiile AI folosesc un serviciu extern (OpenRouter, care transmite cererea unui model AI al Anthropic, SUA). Cererile nu sunt jurnalizate de noi: păstrăm doar tipul funcției, reușita și durata. Răspunsurile sunt ținute temporar în memorie 5 minute. Dacă dezactivați funcțiile AI, nu mai trimitem nimic furnizorului.

## 8. Profilare și decizii automatizate

Folosim următoarele prelucrări automate (art. 22):

**Ordinea recomandărilor (profilare).** Pentru fiecare profil potrivit calculăm un scor de compatibilitate din:

- interesele comune (cea mai mare pondere);
- asemănarea profilurilor de umor (numai cât timp testul de umor este activat);
- statutele de întâlniri comune;
- distanță (cu cât mai aproape, cu atât mai mult);
- limbile comune;
- activitatea recentă în aplicație și insigna „verificat”.

**Testul de umor** este dezactivat implicit și îl putem activa din administrare. Când este activ, vi se explică înainte de început la ce folosește, iar completarea lui poate fi cerută înainte de a aprecia profiluri. Rezultatul influențează scorul de compatibilitate numai cât timp testul este activ.

Vă arătăm întâi profilurile care corespund preferințelor dumneavoastră (gen, vârstă, rază), în ordinea scorului. Nu arătăm conturile inactive de peste 30 de zile. Când nu mai există astfel de profiluri, putem lărgi treptat căutarea: întâi fără limitele de vârstă și rază, apoi cu profiluri respinse de dumneavoastră acum cel puțin 24 de ore („a doua șansă”), apoi cu alte profiluri. Scorul nu este afișat altor utilizatori și nu este vândut nimănui.

**Moderarea automată a fotografiilor.** Fotografiile de profil și poveștile pot fi verificate automat (de un model AI sau, la nevoie, de o verificare locală) pentru nuditate sau conținut nepermis. Ele pot fi respinse înainte de publicare. Cazurile incerte sunt lăsate pentru verificare umană.

**Mascarea datelor de contact.** Numerele de telefon, adresele de e-mail, linkurile și conturile de rețele sociale din mesaje sunt înlocuite automat cu „****”, ca protecție împotriva escrocheriilor. Textul original nu este păstrat.

**Ascunderea automată.** Un cont raportat de mai mulți utilizatori diferiți (în prezent, 3) poate fi ascuns automat până la verificarea de către un moderator.

Aceste prelucrări nu produc efecte juridice asupra dumneavoastră. Suspendarea definitivă a unui cont este decisă întotdeauna de un moderator uman. Aveți dreptul să cereți intervenție umană, să vă exprimați punctul de vedere și să contestați o decizie automată, scriindu-ne la [{{contact_email}}](mailto:{{contact_email}}). Vă puteți opune profilării folosite pentru ordonarea recomandărilor. În acest caz recomandările pot deveni mai puțin relevante.

## 9. Vârsta minimă

FLIRT este destinat exclusiv persoanelor de cel puțin **18 ani**. Confirmați vârsta la intrarea în aplicație, iar data nașterii este verificată la crearea profilului. Nu colectăm cu bună știință date despre minori. Dacă aflăm că un cont aparține unei persoane sub 18 ani, îl suspendăm și ștergem datele. Ne puteți semnala astfel de cazuri la [{{contact_email}}](mailto:{{contact_email}}).

## 10. Cui transmitem datele

**Altor utilizatori.** Alți utilizatori văd profilul dumneavoastră public: numele, vârsta, fotografiile, orașul, distanța aproximativă (în kilometri întregi), interesele, descrierea, insigna „verificat” și poveștile. Mesajele sunt vizibile doar participanților la conversație. Nu afișăm e-mailul, telefonul, data nașterii, strada, coordonatele și genurile care vă interesează.

În centrul de activitate, persoanele pe care le apreciați (inclusiv prin super-apreciere) și cele cu care aveți o potrivire văd profilul dumneavoastră. Respingerile apar celuilalt doar ca număr total, fără identitate. Vizualizările de profil apar doar ca număr (total, ultimele 7 zile și pe zile), niciodată cine a vizitat. Dacă nu aveți fotografii proprii, interlocutorii văd fotografia dumneavoastră de profil Telegram (secțiunea 4).

**Personalului de la intrarea la evenimente.** La scanarea biletului, personalul vede prenumele, vârsta și prima fotografie de profil a titularului, ca să confirme identitatea.

**Persoane împuternicite** (prelucrează date în numele nostru, conform art. 28):

| Destinatar | Rol | Ce primește | Unde | Când |
|---|---|---|---|---|
| Furnizorul de găzduire (centru de date din Chișinău) | serverele, baza de date, fișierele media, copiile de siguranță | toate datele stocate (criptate în tranzit) | Republica Moldova | permanent |
| Telegram (Telegram FZ-LLC și afiliații) | autentificarea, rularea Mini App-ului, notificările prin bot, preluarea fotografiei de profil Telegram | identificatorul Telegram, textul notificărilor | infrastructură globală | permanent |
| OpenRouter, Inc. și Anthropic PBC | funcțiile AI; moderarea automată a fotografiilor | fragmentele de conversație și datele din secțiunea 7; fotografia încărcată, fără identificatorul dumneavoastră | SUA | doar când funcțiile sunt activate |
| OpenStreetMap Foundation (Nominatim) | transformarea orașului / străzii în coordonate | doar textul „stradă, oraș”, fără identificatorul dumneavoastră | UE / Regatul Unit | la salvarea profilului |
| Amazon Web Services | verificarea facială (Rekognition); stocare opțională (S3) | selfie, fotografia de profil | UE / SUA | doar când sunt activate (în prezent nu) |
| Apple, Google, Expo, Firebase Cloud Messaging, Twilio, procesatorul de plăți | autentificare, abonamente, notificări push, coduri SMS (aplicația mobilă) | datele strict necesare serviciului respectiv | UE / SUA | doar în aplicația mobilă, când sunt activate |

Furnizorii prelucrează datele numai pe baza instrucțiunilor noastre și sunt obligați contractual să le protejeze.

**Resurse încărcate direct de Mini App.** Ca orice pagină web, Mini App-ul încarcă câteva resurse de pe servere terțe. Acestea primesc adresa IP a dispozitivului și tipul browserului:

- scriptul Telegram Web App (telegram.org);
- fonturile Google Fonts (Google);
- hărțile OpenStreetMap de pe pagina evenimentelor;
- fotografiile de profil Telegram ale interlocutorilor (de pe serverele Telegram), doar până când copia lor ajunge pe serverul nostru.

Nu le transmitem alte date despre dumneavoastră.

**Operatori independenți.** Banca sau instituția de plată prin care plătiți biletul. Autoritățile publice, instanțele și organele de drept, atunci când legea ne obligă sau pentru protecția vieții și siguranței unei persoane. Consultanții noștri juridici și contabili, care au obligația de confidențialitate.

**Nu vindem datele** și nu le transmitem rețelelor de publicitate sau brokerilor de date. Anunțurile din aplicație sunt ale noastre și sunt alese pe server. Nu le transmitem nimic despre dumneavoastră celor care plasează anunțurile.

## 11. Transferuri în afara Republicii Moldova

Datele sunt stocate în Republica Moldova. Unii furnizori din secțiunea 10 le prelucrează însă în alte state: Telegram (infrastructură globală), OpenRouter și Anthropic (SUA), iar Amazon Web Services, Apple, Google, Expo, Firebase și Twilio (UE sau SUA), atunci când serviciile lor sunt folosite.

Transferăm date numai în condițiile art. 44–50:

- către state sau organizații recunoscute ca asigurând un nivel adecvat de protecție;
- pe baza unor garanții adecvate, de exemplu clauze contractuale standard;
- în lipsa acestora, în situațiile derogatorii permise de lege, de exemplu când transferul este necesar pentru serviciul pe care l-ați cerut sau când v-ați dat consimțământul explicit.

Transmitem cât mai puține date. Furnizorul AI primește doar fragmente scurte, fără nume și identificatori. Pentru moderare se trimite doar fotografia, iar pentru geocodare doar textul adresei. Ne puteți cere informații despre garanțiile aplicate și o copie a acestora la [{{contact_email}}](mailto:{{contact_email}}).

## 12. Cât timp păstrăm datele

| Date | Termen |
|---|---|
| Contul și profilul | cât există contul. Conturile inactive de peste 30 de zile nu mai apar în recomandări. |
| **Cererea de ștergere a contului** | profilul este ascuns imediat și toate sesiunile se închid. Urmează o perioadă de grație de **{{grace_days}} de zile**, în care puteți anula cererea. După ea, datele se șterg sau se anonimizează automat și definitiv (vezi mai jos). |
| Fotografii, povești, mesaje, aprecieri, potriviri, favorite, blocări, setări, sesiuni, dispozitive, bilet, participări, ștampile Flirt Passport, abonament | până le ștergeți dumneavoastră sau până la ștergerea contului. Mesajele se șterg și la ștergerea contului interlocutorului. |
| Poveștile | sunt vizibile altora 24 de ore, apoi rămân arhivate în contul dumneavoastră până le ștergeți sau până la ștergerea contului |
| Fotografia de profil Telegram (copia de pe server) | se reîmprospătează la fiecare intrare prin Telegram. Dacă ștergeți sau ascundeți fotografia în Telegram, copia se șterge la o intrare ulterioară. Se șterge și la ștergerea definitivă a contului. |
| Vizualizările de profil și starea „citit” a activității | cât există contul; nu au un termen automat de ștergere. După ștergerea definitivă a contului nu mai sunt afișate nimănui și rămân doar legate de identificatorul intern al contului șters, fără profil, nume sau fotografii. |
| Comenzile de bilete | la ștergerea contului se anonimizează: se șterg numele, telefonul, e-mailul, mesajele, notele și descrierea plății. Suma, moneda, numărul de bilete, referința de plată, evenimentul, datele și starea comenzii rămân ca evidență contabilă, conform Legii nr. 287/2017, și nu vă mai identifică. |
| Dovezile de plată (imaginile chitanțelor) | **{{proof_retention_years}} ani** de la data comenzii, ca documente justificative contabile, apoi se șterg automat. Dovezile comenzilor respinse sau anulate se șterg la **{{rejected_proof_days}} de zile** de la decizie sau imediat la ștergerea contului. |
| Înregistrările de intrare la evenimente și codurile de invitație folosite | ca evidență a evenimentelor și a reducerilor acordate. Nu mai sunt legate de un profil după ștergerea contului. |
| Înregistrarea tehnică minimă a contului șters | identificatorul intern, identificatorul Telegram, limba și data ștergerii. Le păstrăm ca dovadă a ștergerii și ca să împiedicăm revenirea conturilor suspendate pentru abuz (interes legitim). |
| Raportările de moderare | se păstrează și după ștergerea contului, legate de contul anonimizat, pentru prevenirea abuzurilor și apărarea unor drepturi în justiție |
| Evidența consimțămintelor | pe durata contului. După ștergere se păstrează ca probă, fără adresa IP și agentul utilizator. |
| Copiile de siguranță (backup) | **{{backup_days}} zile**. Datele șterse dispar din copii după cel mult {{backup_days}} zile. |
| Jurnalele tehnice | jurnalele de acces conțin adresa IP doar trunchiată (de exemplu 1.2.3.0) și nu conțin parametrii cererilor. Toate jurnalele se șterg după cel mult **{{log_retention_days}} de zile**. Jurnalele de erori, de exemplu cu tentativele de atac blocate, pot conține adresa IP completă. |
| Contoarele de limitare a abuzurilor | de la câteva minute la câteva ore |
| Cererile către furnizorul AI | nu le stocăm. Răspunsul e ținut temporar 5 minute. |
| Selfie-ul de verificare | nu se stochează |

## 13. Drepturile dumneavoastră

Conform art. 13–22 aveți următoarele drepturi:

| Drept | Ce înseamnă | Cum îl exercitați |
|---|---|---|
| **De informare** (art. 13–14) | să știți ce date prelucrăm, de ce și cum | această politică |
| **De acces** (art. 15) | să aflați dacă vă prelucrăm datele și să primiți o copie a lor | „Confidențialitate și date” → descărcarea datelor sau e-mail |
| **La rectificare** (art. 16) | să corectați datele inexacte sau incomplete | direct din profil și setări sau e-mail |
| **La ștergere** („dreptul de a fi uitat”, art. 17) | să cereți ștergerea datelor | Setări → „Ștergerea contului” sau e-mail |
| **La restricționarea prelucrării** (art. 18–19) | să cereți să stocăm datele fără să le mai folosim, de exemplu cât timp verificăm o contestație | e-mail |
| **La portabilitate** (art. 20) | să primiți datele furnizate de dumneavoastră într-un format structurat, citibil automat (JSON) | „Confidențialitate și date” → descărcarea datelor |
| **La opoziție** (art. 21) | să vă opuneți prelucrărilor bazate pe interes legitim, inclusiv profilării | e-mail |
| **Privind deciziile automatizate** (art. 22) | să nu faceți obiectul unei decizii bazate exclusiv pe prelucrare automată care vă afectează semnificativ; să cereți intervenție umană și să contestați decizia | e-mail |
| **De a vă retrage consimțământul** | oricând, fără a afecta legalitatea prelucrării de până atunci | Setări (AI, notificări), „Confidențialitate și date” (verificare facială), ștergerea contului |
| **De a depune plângere** (art. 74) | la CNPDCP și în instanța de judecată | secțiunea 14 |

**Ce conține exportul de date:** contul (fără parolă), profilul, setările, aprecierile trimise, potrivirile, conversațiile și **mesajele trimise de dumneavoastră**, favoritele, blocările, raportările trimise, poveștile, participările la evenimente, ștampilele, reducerile, biletul, comenzile, abonamentele, sesiunile (doar date calendaristice), consimțămintele și cererea de ștergere. Exportul nu conține mesajele altor persoane, pentru a le proteja datele.

**Termen de răspuns.** Răspundem fără întârzieri nejustificate, în cel mult **o lună** de la primirea cererii. Pentru cereri complexe sau numeroase, termenul se poate prelungi cu cel mult **încă două luni**. Dacă se întâmplă asta, vă anunțăm în prima lună și vă explicăm motivul.

Ca să vă protejăm datele, vă putem cere informații suplimentare pentru confirmarea identității, de exemplu să trimiteți cererea din contul Telegram legat de profil. Exercitarea drepturilor este gratuită. Pentru cereri vădit nefondate sau excesive putem percepe o taxă rezonabilă sau putem refuza cererea motivat.

## 14. Plângere la autoritatea de supraveghere

Dacă considerați că drepturile dumneavoastră au fost încălcate, vă rugăm să ne scrieți mai întâi, ca să încercăm să rezolvăm situația. Aveți însă dreptul să depuneți oricând o plângere la autoritatea de supraveghere:

**Centrul Național pentru Protecția Datelor cu Caracter Personal (CNPDCP)**

- adresă: str. Serghei Lazo 48, MD-2004, Chișinău, Republica Moldova;
- telefon: (022) 820 801;
- e-mail: [centru@datepersonale.md](mailto:centru@datepersonale.md);
- site: [www.datepersonale.md](https://www.datepersonale.md).

Aveți, de asemenea, dreptul să vă adresați instanței de judecată, inclusiv pentru despăgubiri. Dacă locuiți în UE/SEE, vă puteți adresa și autorității de protecție a datelor din statul dumneavoastră.

## 15. Securitatea datelor

Aplicăm măsuri tehnice și organizatorice adecvate riscului (art. 32):

- tot traficul dintre aplicație și servere este criptat (HTTPS/TLS);
- autentificarea prin Telegram este verificată criptografic (semnătura datelor de lansare). Fiecare lansare poate fi folosită o singură dată, ca protecție împotriva reutilizării;
- sesiunile folosesc jetoane de acces semnate (JWT) valabile 15 minute și jetoane de reîmprospătare rotite, stocate pe server doar ca hash. Reutilizarea unui jeton vechi închide sesiunea. La cererea de ștergere se închid toate sesiunile;
- parolele (aplicația mobilă) sunt stocate exclusiv ca hash Argon2;
- numărul de cereri este limitat, ca protecție împotriva atacurilor și abuzurilor;
- fișierele încărcate sunt validate (tip, dimensiune, conținut). Fotografiile încărcate și copia fotografiei Telegram sunt re-encodate pe server fără metadate (inclusiv localizarea GPS din EXIF), iar pentru afișare se generează copii micșorate (WebP). Mini App-ul redimensionează în plus fotografiile de profil pe dispozitiv înainte de încărcare;
- accesul la datele de producție este limitat la persoane autorizate, iar acțiunile administrative sunt jurnalizate. Panoul de administrare nu permite citirea conversațiilor;
- facem copii de siguranță zilnice, cu termen limitat de păstrare.

## 16. Incidente de securitate

Niciun sistem nu este complet sigur. Dacă se produce o încălcare a securității datelor (de exemplu acces neautorizat, pierdere sau divulgare), o documentăm și luăm imediat măsuri de limitare. Dacă incidentul prezintă un risc pentru drepturile și libertățile persoanelor, **notificăm CNPDCP în cel mult 72 de ore** de la momentul în care am aflat de el (art. 33). Dacă riscul este ridicat, **vă informăm și pe dumneavoastră** fără întârzieri nejustificate (art. 34): ce s-a întâmplat, ce date sunt afectate, ce măsuri am luat și ce puteți face pentru a vă proteja.

## 17. Cookie-uri și stocare locală

Mini App-ul FLIRT **nu folosește cookie-uri de urmărire**, instrumente de analiză sau trackere publicitare. Folosim stocarea browserului strict pentru funcționarea aplicației:

| Stocare | Ce conține | Cât timp |
|---|---|---|
| sessionStorage | jetoanele de sesiune, legate de contul Telegram | până la închiderea Mini App-ului |
| localStorage | preferințe de interfață: biletele deja afișate, emoji-urile recente, poveștile văzute, indicațiile de gesturi văzute, starea solicitării permisiunii de notificare | până la ștergerea datelor aplicației Telegram |

Aceste date rămân pe dispozitivul dumneavoastră și nu le folosim pentru urmărire. Telegram, în care rulează Mini App-ul, prelucrează date conform propriei politici: [telegram.org/privacy](https://telegram.org/privacy).

## 18. Modificarea politicii

Actualizăm politica atunci când se schimbă serviciul, modul de prelucrare sau legislația. Fiecare versiune are un număr și o dată de intrare în vigoare. La modificări de fond vă anunțăm în aplicație și vă cerem să confirmați noua versiune înainte de a continua. Acolo unde prelucrarea se bazează pe consimțământ, vă cerem un nou consimțământ. Versiunile anterioare vi le putem trimite la cerere.

## 19. Contact

Pentru orice întrebare despre această politică sau despre datele dumneavoastră:

- {{operator_name}}, {{operator_address}}
- E-mail: [{{contact_email}}](mailto:{{contact_email}})
- Responsabil cu protecția datelor: {{dpo_contact}}
