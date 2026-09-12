/**
 * Stocarea sesiunii: access-ul DOAR în memorie, refresh-ul în `sessionStorage`.
 *
 * De ce refresh-ul nu mai stă doar în memorie. Telegram trimite ACELAȘI `initData`
 * pe toată durata unei lansări a Mini App-ului, iar backendul consumă fiecare
 * semnătură o singură dată, ca să nu poată fi reutilizată de cineva care o
 * interceptează. Cele două reguli se ciocneau într-un gest banal: o reîncărcare
 * a paginii în WebView golea memoria, aplicația retrimitea aceeaşi semnătură, iar
 * serverul o respingea pe bună dreptate ca deja folosită. Utilizatorul rămânea
 * blocat pe „sesiune expirată" până închidea complet aplicația.
 *
 * `sessionStorage`, nu `localStorage`, şi diferenţa contează:
 *   - moare când se închide Mini App-ul, deci nu lasă un token de lungă durată pe
 *     dispozitiv;
 *   - supravieţuieşte unei reîncărcări, care e exact cazul pe care îl reparăm.
 *
 * Preţul, asumat explicit: refresh-ul devine citibil de orice script din pagină.
 * Riscul e mic în context — pagina rulează doar codul nostru plus programul
 * oficial Telegram — iar un atacator care ar putea executa cod în pagină are
 * oricum tokenul de acces din memorie şi poate chema API-ul direct.
 *
 * Orice acces la stocare e protejat: în mod incognito sau cu stocarea blocată,
 * citirea şi scrierea aruncă, iar aplicaţia trebuie să funcţioneze oricum, doar
 * fără avantajul supravieţuirii la reîncărcare.
 */

const CHEIE_REFRESH = 'flirt.refresh';

let accessToken: string | null = null;
let refreshToken: string | null = null;

/** `sessionStorage`, dacă e disponibil. Poate lipsi sau poate arunca la acces. */
function stocare(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function citesteRefresh(): string | null {
  try {
    return stocare()?.getItem(CHEIE_REFRESH) ?? null;
  } catch {
    return null;
  }
}

function scrieRefresh(valoare: string | null): void {
  try {
    const s = stocare();
    if (!s) return;
    if (valoare === null) s.removeItem(CHEIE_REFRESH);
    else s.setItem(CHEIE_REFRESH, valoare);
  } catch {
    // Stocare blocată: rămânem doar cu memoria. Nu e o eroare de raportat
    // utilizatorului, doar pierdem supravieţuirea la reîncărcare.
  }
}

export const tokenStore = {
  getAccess: (): string | null => accessToken,
  /** Memoria are prioritate; stocarea acoperă cazul de după o reîncărcare. */
  getRefresh: (): string | null => refreshToken ?? citesteRefresh(),
  setAccess: (t: string | null): void => {
    accessToken = t;
  },
  setTokens: (access: string, refresh: string): void => {
    accessToken = access;
    refreshToken = refresh;
    scrieRefresh(refresh);
  },
  clear: (): void => {
    accessToken = null;
    refreshToken = null;
    scrieRefresh(null);
  },
};
