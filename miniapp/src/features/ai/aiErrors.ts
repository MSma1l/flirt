/**
 * Traducerea eșecurilor AI într-un set MIC și STABIL de cauze.
 *
 * DE CE un strat separat. Ecranele nu au voie să se uite la `error.response.
 * status`: fiecare stare din interfață („funcția e oprită", „AI-ul nu e
 * configurat pe server", „ai atins limita") are un text propriu, util, iar
 * textul acela se alege o singură dată, aici. Restul codului vede doar
 * `AiError.kind`.
 *
 * CONTRACTUL REAL, citit din `backend/app/schemas/ai.py` și
 * `backend/app/api/v1/ai.py`:
 *
 *  - Pana furnizorului NU e o eroare HTTP. Ruta întoarce 200 cu
 *    `available: false` + o etichetă `reason` STABILĂ:
 *    `ai_not_configured`, `ai_provider_error`, `ai_empty_response`,
 *    `ai_no_history`. Le traducem în `kindFromReason`.
 *  - Erorile HTTP rămân pentru ce NU e degradare: 403 (funcția e oprită pe
 *    cont — alegerea userului), 404 (nu ești participant / profil ascuns),
 *    429 (limita de cereri).
 */
import axios from 'axios';

/**
 * Cauzele pe care interfața le tratează diferit. Orice altceva cade pe
 * `unknown` — o singură stare-cutie-neagră, nu zece texte inventate.
 */
export type AiErrorKind =
  /** `ai_enabled = false` pe cont: userul nu a pornit funcția (403). */
  | 'disabled'
  /** Serverul nu are provider/cheie AI (`reason: ai_not_configured`). */
  | 'not_configured'
  /** Limita de cereri, a noastră sau a furnizorului (429). */
  | 'rate_limit'
  /** Furnizorul a picat sau a răspuns gol (`ai_provider_error`/`ai_empty_response`). */
  | 'provider'
  /** Conversația nu are încă destul text de pe care să pornească (`ai_no_history`). */
  | 'no_history'
  /** Conversația sau profilul nu mai sunt accesibile (404). */
  | 'not_found'
  /** Cererea nu a ajuns la server (telefon fără rețea, server căzut). */
  | 'network'
  | 'unknown';

/** Eroare de AI cu cauza deja clasificată. */
export class AiError extends Error {
  readonly kind: AiErrorKind;

  constructor(kind: AiErrorKind, message?: string) {
    super(message ?? kind);
    this.name = 'AiError';
    this.kind = kind;
  }
}

/**
 * Etichetele `reason` din `backend/app/schemas/ai.py` → cauza noastră.
 *
 * `ai_provider_error` și `ai_empty_response` cad amândouă pe `provider`: pentru
 * utilizator diferența nu schimbă nimic („serviciul nu a răspuns cum trebuie"),
 * iar două texte aproape identice ar fi zgomot. În loguri rămân distincte.
 */
const REASON_TO_KIND: Record<string, AiErrorKind> = {
  ai_not_configured: 'not_configured',
  ai_provider_error: 'provider',
  ai_empty_response: 'provider',
  ai_no_history: 'no_history',
};

/**
 * Cauza unei degradări (răspuns 200 cu `available: false`).
 * O etichetă necunoscută — adăugată pe server după scrierea acestui fișier —
 * devine `provider`, nu `unknown`: e tot „AI-ul n-a putut acum", și e mai util
 * decât o cutie neagră.
 */
export function kindFromReason(reason: string | null | undefined): AiErrorKind {
  if (!reason) return 'provider';
  return REASON_TO_KIND[reason.trim().toLowerCase()] ?? 'provider';
}

/** Extrage `detail` dintr-un corp FastAPI, fie el șir sau obiect. */
function readDetail(data: unknown): string {
  if (typeof data === 'string') return data;
  if (!data || typeof data !== 'object') return '';
  const detail = (data as { detail?: unknown }).detail;
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object') {
    const code = (detail as { code?: unknown; reason?: unknown }).code
      ?? (detail as { reason?: unknown }).reason;
    if (typeof code === 'string') return code;
  }
  return '';
}

/** Codul HTTP → cauză. Vezi docstring-urile rutelor din `api/v1/ai.py`. */
function kindFromStatus(status: number): AiErrorKind {
  if (status === 429) return 'rate_limit';
  // 403: funcțiile AI sunt oprite pe cont (sau userul e blocat de celălalt).
  if (status === 403) return 'disabled';
  // 404: nu ești participant la conversație / profil ascuns, banat, șters.
  if (status === 404) return 'not_found';
  if (status === 501 || status === 503) return 'not_configured';
  if (status === 502 || status === 504) return 'provider';
  return 'unknown';
}

/**
 * Transformă orice eșec în `AiError`. Un `AiError` deja clasificat trece
 * neatins — funcțiile de date îl aruncă direct pentru degradările din corp.
 */
export function toAiError(error: unknown): AiError {
  if (error instanceof AiError) return error;

  if (axios.isAxiosError(error)) {
    // Fără răspuns = cererea nici nu a ajuns (rețea, CORS, timeout de client).
    if (!error.response) return new AiError('network', error.message);

    // Ruta poate pune eticheta `reason` și în `detail`-ul unui 4xx; dacă e una
    // cunoscută, o preferăm codului HTTP — e informația mai precisă.
    const detail = readDetail(error.response.data).trim().toLowerCase();
    const fromReason = REASON_TO_KIND[detail];
    if (fromReason) return new AiError(fromReason, error.message);

    return new AiError(kindFromStatus(error.response.status), error.message);
  }

  return new AiError('unknown', error instanceof Error ? error.message : undefined);
}

/**
 * Cheia de traducere pentru o cauză, în namespace-ul `miniapp`.
 * Un singur loc care leagă cauza de text — ecranele nu construiesc chei.
 */
export function aiErrorKey(kind: AiErrorKind): string {
  return `miniapp:ai.errors.${kind}`;
}
