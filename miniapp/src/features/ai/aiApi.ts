/**
 * Stratul de date al funcțiilor AI din Mini App.
 *
 * CONTRACTUL, citit din repo (nu presupus)
 * ----------------------------------------
 * `backend/app/api/v1/ai.py` + `backend/app/schemas/ai.py`:
 *
 *   POST /ai/chat-hint            body `{ chat_id }`
 *        → `{ available, suggestions: string[], reason, cached }`
 *   GET  /ai/chemistry/{user_id}
 *        → `{ user_id, score, available, explanation, reason }`
 *
 * Trei lucruri din contractul ăsta schimbă interfața, nu doar tipurile:
 *
 *  1. SUGESTIILE VIN LA PLURAL. Ruta întoarce o listă, nu un text. Le arătăm pe
 *     toate și îl lăsăm pe utilizator să aleagă — a alege noi una din listă și a
 *     ascunde restul ar fi o decizie luată în locul lui, degeaba.
 *
 *  2. `chat_id` MERGE ÎN CORP, NU ÎN CALE, și e un POST. Nu trimitem niciun
 *     fragment de conversație de la client: serverul citește mesajele singur din
 *     baza de date, după ce verifică apartenența. Clientul nu are ce adăuga.
 *
 *  3. PANA FURNIZORULUI E UN 200, NU O EROARE. `available: false` + o etichetă
 *     `reason` stabilă. Pentru sugestii o ridicăm ca `AiError` (fără sugestii nu
 *     avem ce arăta), dar pentru chimie NU: acolo `score` vine MEREU — e scorul
 *     determinist din `services/compatibility.py`, același pe care îl arată
 *     feed-ul și antetul conversației. Doar explicația e partea AI. Deci
 *     `fetchChemistry` întoarce scorul chiar și când AI-ul lipsește, plus cauza
 *     pentru care explicația lipsește. A arunca acolo ar fi ascuns o cifră pe
 *     care o avem.
 */
import { api } from '@/api/client';

import { AiError, kindFromReason, toAiError, type AiErrorKind } from './aiErrors';

/** Căile rutelor AI. SINGURUL loc din Mini App care le cunoaște. */
export const AI_ROUTES = {
  /** Sugestii de mesaj pentru o conversație (POST, `chat_id` în corp). */
  chatHint: '/ai/chat-hint',
  /** Scorul de chimie, explicat, față de un utilizator. */
  chemistry: (userId: string) => `/ai/chemistry/${encodeURIComponent(userId)}`,
} as const;

/** Sugestiile propuse pentru o conversație. Text simplu — decizia e a userului. */
export interface ChatHint {
  /** Cel puțin una; altfel funcția aruncă `AiError`. */
  suggestions: string[];
  /** A venit din memoria temporară a serverului (util doar la depanare). */
  cached: boolean;
}

/** Scorul de chimie: cifra deterministă + explicația AI, care poate lipsi. */
export interface ChemistryResult {
  /** 0–100. Vine MEREU, chiar și fără AI. */
  score: number;
  /** Explicația AI, sau `null` când nu e disponibilă. */
  explanation: string | null;
  /** `null` = avem explicație; altfel cauza pentru care lipsește. */
  unavailable: AiErrorKind | null;
}

/* --------------------------- Forme brute (backend) ---------------------- */

interface ChatHintResponse {
  available?: boolean;
  suggestions?: unknown;
  reason?: string | null;
  cached?: boolean;
}

interface ChemistryResponse {
  user_id?: string;
  score?: number;
  available?: boolean;
  explanation?: string | null;
  reason?: string | null;
}

/** Păstrează doar șirurile non-goale, curățate la capete. */
function cleanSuggestions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/* --------------------------------- API ---------------------------------- */

/**
 * Cere sugestii de mesaj pentru conversația dată.
 *
 * NU trimite nimic nimănui: întoarce doar texte propuse. Decizia de a folosi
 * vreunul e a utilizatorului (vezi `AiAssistBar`).
 *
 * Aruncă `AiError` cu cauza deja clasificată — și pentru erorile HTTP (403 =
 * funcția e oprită pe cont, 404 = nu ești participant, 429 = limita), și pentru
 * degradările întoarse cu 200 (`available: false`), și pentru un `available:
 * true` cu listă goală, care ar fi un contract încălcat.
 */
export async function fetchChatHint(chatId: string): Promise<ChatHint> {
  try {
    const { data } = await api.post<ChatHintResponse>(AI_ROUTES.chatHint, {
      chat_id: chatId,
    });

    if (data?.available !== true) throw new AiError(kindFromReason(data?.reason));

    const suggestions = cleanSuggestions(data.suggestions);
    // `available: true` fără sugestii e tot „n-avem ce arăta": o bulă goală ar fi
    // mai rea decât un mesaj care spune că serviciul nu a răspuns.
    if (suggestions.length === 0) throw new AiError('provider', 'listă goală');

    return { suggestions, cached: data.cached === true };
  } catch (error) {
    throw toAiError(error);
  }
}

/**
 * Cere scorul de chimie față de un utilizator, cu explicație.
 *
 * Aruncă DOAR pentru erori HTTP (403 blocare / AI oprit, 404 profil ascuns,
 * 429 limită, rețea). O pană a AI-ului nu aruncă: întoarce scorul determinist
 * și cauza pentru care explicația lipsește.
 */
export async function fetchChemistry(userId: string): Promise<ChemistryResult> {
  try {
    const { data } = await api.get<ChemistryResponse>(AI_ROUTES.chemistry(userId));

    const raw = Number(data?.score);
    // `score` e garantat de schemă (`ge=0, le=100`). Plafonăm oricum: un răspuns
    // stricat nu are voie să producă o bară de 4000%.
    const score = Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : 0;

    const explanation =
      data?.available === true && typeof data.explanation === 'string' && data.explanation.trim()
        ? data.explanation.trim()
        : null;

    return {
      score,
      explanation,
      unavailable: explanation ? null : kindFromReason(data?.reason),
    };
  } catch (error) {
    throw toAiError(error);
  }
}
