/**
 * Stocarea sesiunii: perechea de tokenuri în memorie ȘI în `sessionStorage`,
 * legată de contul Telegram care a deschis Mini App-ul.
 *
 * DE CE PERSISTĂM (până acum nu persistam nimic)
 * ----------------------------------------------
 * Telegram trimite ACELAȘI `initData` pe toată durata unei lansări a Mini
 * App-ului (stă în fragmentul adresei, `#tgWebAppData=…`), iar backendul consumă
 * fiecare semnătură o singură dată (anti-replay, `init_data_reused`). Cele două
 * reguli se ciocneau la orice reîncărcare a paginii — „⋯ → Reload", WebView-ul
 * iOS/Android restaurat după fundal, o reîncărcare după o eroare JS: memoria se
 * golea, aplicația retrimitea aceeași semnătură, serverul o respingea pe bună
 * dreptate, iar utilizatorul rămânea blocat până închidea aplicația.
 *
 * Acum, la pornire, `authStore.signIn` încearcă ÎNTÂI sesiunea salvată (cu
 * reînnoire prin `POST /auth/refresh` dacă accesul a expirat) și trimite
 * `initData` DOAR dacă nu există una utilizabilă. Protecția anti-replay din
 * backend rămâne neatinsă.
 *
 * `sessionStorage`, nu `localStorage`, şi diferenţa contează:
 *   - moare când se închide Mini App-ul, deci nu lasă un token de lungă durată pe
 *     dispozitiv;
 *   - supravieţuieşte unei reîncărcări, care e exact cazul pe care îl reparăm.
 *
 * LEGAREA DE CONT. Perechea se salvează împreună cu id-ul Telegram (din
 * `initDataUnsafe.user.id`) și se restaurează DOAR pentru același id. Alt cont
 * Telegram în același WebView nu preia niciodată sesiunea altcuiva — perechea
 * străină e ștearsă. Id-ul nesigur NU dovedește identitatea: el doar alege ce
 * tokenuri încercăm; serverul validează tokenurile oricum. Fără id cunoscut nu
 * salvăm nimic pe disc (rămânem doar în memorie).
 *
 * Preţul, asumat explicit: tokenurile devin citibile de orice script din pagină.
 * Riscul e mic în context — pagina rulează doar codul nostru plus programul
 * oficial Telegram — iar un atacator care ar putea executa cod în pagină are
 * oricum tokenul de acces din memorie şi poate chema API-ul direct.
 *
 * Orice acces la stocare e protejat: în mod incognito sau cu stocarea blocată,
 * citirea şi scrierea aruncă, iar aplicaţia trebuie să funcţioneze oricum, doar
 * fără avantajul supravieţuirii la reîncărcare.
 */

const CHEIE_SESIUNE = 'flirt.session';
/** Formatul vechi (doar refresh, nelegat de cont). Doar se șterge. */
const CHEIE_VECHE = 'flirt.refresh';

interface SesiuneSalvata {
  owner: string;
  access: string;
  refresh: string;
}

let accessToken: string | null = null;
let refreshToken: string | null = null;
/** Id-ul Telegram (nesigur) al celui care a deschis aplicația. */
let owner: string | null = null;

/** `sessionStorage`, dacă e disponibil. Poate lipsi sau poate arunca la acces. */
function stocare(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function citesteSesiune(): SesiuneSalvata | null {
  try {
    const brut = stocare()?.getItem(CHEIE_SESIUNE);
    if (!brut) return null;
    const s = JSON.parse(brut) as Partial<SesiuneSalvata> | null;
    if (
      s &&
      typeof s.owner === 'string' &&
      typeof s.access === 'string' &&
      typeof s.refresh === 'string' &&
      s.owner &&
      s.refresh
    ) {
      return { owner: s.owner, access: s.access, refresh: s.refresh };
    }
    return null;
  } catch {
    // Stocare blocată sau JSON corupt: ca și cum n-ar exista.
    return null;
  }
}

function scrieSesiune(valoare: SesiuneSalvata | null): void {
  try {
    const s = stocare();
    if (!s) return;
    s.removeItem(CHEIE_VECHE);
    if (valoare === null) s.removeItem(CHEIE_SESIUNE);
    else s.setItem(CHEIE_SESIUNE, JSON.stringify(valoare));
  } catch {
    // Stocare blocată: rămânem doar cu memoria. Nu e o eroare de raportat
    // utilizatorului, doar pierdem supravieţuirea la reîncărcare.
  }
}

function persista(): void {
  if (owner && refreshToken) {
    scrieSesiune({ owner, access: accessToken ?? '', refresh: refreshToken });
  } else {
    scrieSesiune(null);
  }
}

export const tokenStore = {
  getAccess: (): string | null => accessToken,
  getRefresh: (): string | null => refreshToken,
  setAccess: (t: string | null): void => {
    accessToken = t;
    persista();
  },
  /**
   * Salvează perechea (inclusiv cea ROTITĂ de `/auth/refresh`) pentru contul
   * legat prin `bindOwner`.
   */
  setTokens: (access: string, refresh: string): void => {
    accessToken = access;
    refreshToken = refresh;
    persista();
  },
  /**
   * Leagă sesiunea de contul Telegram curent. Dacă în memorie e sesiunea
   * altui cont, o golim: nu are voie să fie folosită de acesta.
   */
  bindOwner: (id: string | null): void => {
    if (owner !== null && owner !== id) {
      accessToken = null;
      refreshToken = null;
    }
    owner = id;
  },
  /**
   * Readuce sesiunea contului legat, din memorie sau (după o reîncărcare) din
   * `sessionStorage`. Întoarce `true` dacă există un refresh token utilizabil.
   * O sesiune salvată a ALTUI cont e ștearsă, nu folosită.
   */
  restore: (): boolean => {
    if (!owner) return false;
    if (refreshToken) return true;
    const salvata = citesteSesiune();
    if (!salvata) return false;
    if (salvata.owner !== owner) {
      scrieSesiune(null);
      return false;
    }
    accessToken = salvata.access || null;
    refreshToken = salvata.refresh;
    return true;
  },
  /** Deconectare, ban, sesiune pierdută: golește memoria ȘI stocarea. */
  clear: (): void => {
    accessToken = null;
    refreshToken = null;
    scrieSesiune(null);
  },
};
