/**
 * Traducerea eșecurilor de la `/loyalty/*` într-un set MIC și STABIL de cauze.
 *
 * Același tipar ca `features/ai/aiErrors.ts`: ecranele nu se uită niciodată la
 * `error.response.status`, ci doar la `kind`. Textul pentru fiecare cauză se
 * alege o singură dată, aici.
 *
 * CONTRACTUL REAL, citit din `backend/app/services/loyalty.py::redeem_invite`:
 *   404 — cod inexistent (serverul nu confirmă niciodată existența unui cod străin);
 *   409 — revocată / expirată / epuizată — TREI cazuri, un singur cod HTTP;
 *   403 — treaptă de fidelitate insuficientă, cu pragul cerut în text;
 *   429 — limitatorul de rată al rutei (`rate_limit_invite_redeem_per_min`);
 *   200 — reușită, SAU deja folosită de același user (`consumed_new_use: false`).
 *
 * PARTEA URÂTĂ, asumată explicit: cele trei cazuri de 409 se deosebesc DOAR
 * după `detail`, un text în română scris în serviciu. Nu există un cod stabil
 * de eroare pe care să ne sprijinim. Deci potrivim pe fragmente scurte, după ce
 * scoatem diacriticele — „anulată" vs „anulata" e aceeași literă pentru noi.
 * Dacă textul de pe server se schimbă, nu rămânem fără mesaj: cădem pe un text
 * general de 409 („invitația nu mai poate fi folosită"), care e adevărat în
 * toate cele trei cazuri. Când backendul va expune un cod stabil, se schimbă
 * doar tabelul de mai jos.
 */
import axios from 'axios';

/** Cauzele pe care interfața le tratează cu mesaje diferite. */
export type RedeemErrorKind =
  /** Codul nu există deloc (404). */
  | 'not_found'
  /** Invitația a trecut de `expires_at` (409). */
  | 'expired'
  /** Toate folosirile au fost consumate de alții (409). */
  | 'exhausted'
  /** Organizatorul a anulat invitația (409). */
  | 'revoked'
  /** 409 pe care nu l-am putut deosebi după text. */
  | 'unusable'
  /** Utilizatorul nu are încă ștampilele cerute de invitație (403). */
  | 'tier_too_low'
  /** Prea multe încercări într-un minut (429). */
  | 'rate_limit'
  /** Cererea nici nu a ajuns la server (telefon fără rețea, timeout). */
  | 'network'
  /** Serverul a răspuns cu o eroare pe care nu o traducem separat. */
  | 'server'
  | 'unknown';

/** Eroare de folosire a unui cod, cu cauza deja clasificată. */
export class RedeemError extends Error {
  readonly kind: RedeemErrorKind;

  /**
   * Pragul de ștampile cerut de invitație, când serverul îl scrie în mesaj.
   * `null` dacă nu l-am putut citi — atunci mesajul rămâne fără cifră, în loc
   * să inventăm una.
   */
  readonly requiredStamps: number | null;

  constructor(kind: RedeemErrorKind, requiredStamps: number | null = null, message?: string) {
    super(message ?? kind);
    this.name = 'RedeemError';
    this.kind = kind;
    this.requiredStamps = requiredStamps;
  }
}

/** Extrage `detail` dintr-un corp FastAPI, fie el șir sau obiect. */
function readDetail(data: unknown): string {
  if (typeof data === 'string') return data;
  if (!data || typeof data !== 'object') return '';
  const detail = (data as { detail?: unknown }).detail;
  return typeof detail === 'string' ? detail : '';
}

/** Minuscule, fără diacritice — ca potrivirea să nu depindă de „ă" vs „a". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * Fragmentele care deosebesc cele trei mesaje de 409, în ordinea verificării.
 * Sunt bucăți din `detail`-ul SERVERULUI, nu texte de interfață: interfața își
 * ia cuvintele din catalogul `screens`, ca peste tot.
 */
const CONFLICT_MARKERS: readonly (readonly [string, RedeemErrorKind])[] = [
  ['anulat', 'revoked'],
  ['expirat', 'expired'],
  ['maxim', 'exhausted'],
];

function conflictKind(detail: string): RedeemErrorKind {
  const folded = fold(detail);
  for (const [marker, kind] of CONFLICT_MARKERS) {
    if (folded.includes(marker)) return kind;
  }
  return 'unusable';
}

/** Primul număr întreg din mesaj — pragul de ștampile cerut de invitație. */
function readRequiredStamps(detail: string): number | null {
  const match = /\d+/.exec(detail);
  if (!match) return null;
  const value = Number.parseInt(match[0], 10);
  return Number.isFinite(value) ? value : null;
}

/** Transformă orice eșec al rutei de folosire a codului într-un `RedeemError`. */
export function toRedeemError(error: unknown): RedeemError {
  if (error instanceof RedeemError) return error;

  if (axios.isAxiosError(error)) {
    // Fără răspuns = cererea nici nu a plecat (rețea, CORS, timeout de client).
    if (!error.response) return new RedeemError('network', null, error.message);

    const detail = readDetail(error.response.data);
    switch (error.response.status) {
      case 404:
        return new RedeemError('not_found', null, error.message);
      case 409:
        return new RedeemError(conflictKind(detail), null, error.message);
      case 403:
        return new RedeemError('tier_too_low', readRequiredStamps(detail), error.message);
      case 429:
        return new RedeemError('rate_limit', null, error.message);
      default:
        return new RedeemError(
          error.response.status >= 500 ? 'server' : 'unknown',
          null,
          error.message,
        );
    }
  }

  return new RedeemError('unknown', null, error instanceof Error ? error.message : undefined);
}

/**
 * Cheia de traducere pentru o cauză. Un singur loc care leagă cauza de text —
 * ecranele nu construiesc chei din bucăți.
 */
export function redeemErrorKey(kind: RedeemErrorKind): string {
  return `screens:loyalty.invite.errors.${kind}`;
}

/* ------------------------------------------------- erorile simple de citire */

/** Cauzele unei ÎNCĂRCĂRI eșuate (starea de fidelitate, cotația de preț). */
export type LoadErrorKind = 'network' | 'server';

/**
 * Rețea căzută sau server care a răspuns prost? Sunt două mesaje diferite,
 * fiindcă duc la două acțiuni diferite: „verifică internetul" vs „încearcă mai
 * târziu". Un singur text pentru amândouă ar trimite jumătate din oameni să
 * caute o problemă care nu e la ei.
 */
export function classifyLoadError(error: unknown): LoadErrorKind {
  if (axios.isAxiosError(error) && !error.response) return 'network';
  return 'server';
}

/** Cheia de traducere pentru o eroare de încărcare. */
export function loadErrorKey(kind: LoadErrorKind): string {
  return `screens:loyalty.errors.${kind}`;
}
