/**
 * De ce a fost refuzat swipe-ul, şi UNDE trebuie dus utilizatorul.
 *
 * Problema reală, întâmplată în producţie: fiecare like şi super like primea 403,
 * aplicaţia afişa „nu am putut trimite", iar oamenii rămâneau blocaţi fără să afle
 * ce li se cere. Backendul refuza intenţionat, pentru că nu completaseră testul de
 * umor — şi trimitea un mesaj distinct tocmai ca să fie duşi acolo.
 *
 * Decizia se ia după CODUL stabil din răspuns, nu după text. Textul se traduce şi
 * se rescrie la orice corectură de exprimare; ne-a costat deja de trei ori. Textul
 * rămâne doar ca plasă pentru un server mai vechi, care încă nu trimite codul.
 *
 * Regula de aur a acestui modul: orice refuz necunoscut duce la o acţiune, nu la o
 * fundătură. Mai bine îl trimitem pe utilizator într-un loc aproape potrivit decât
 * să-l lăsăm cu un mesaj şi niciun buton.
 */
import { HUMOR_PATH } from '@/features/humor/humorRoutes';
import { ONBOARDING_PROFILE_PATH, PROFILE_PATH } from '@/features/onboarding/paths';

/** Ce îi lipseşte utilizatorului ca să poată acţiona. */
export type SwipeBlockKind =
  | 'humor'
  | 'photos'
  | 'profile'
  | 'underage'
  | 'blocked'
  | 'self'
  | 'unknown';

export interface SwipeBlock {
  kind: SwipeBlockKind;
  /** Unde îl ducem. `null` = nu are unde, refuzul nu se poate rezolva de el. */
  to: string | null;
  /** Cheia textului explicativ. */
  titleKey: string;
  bodyKey: string;
  /** Cheia butonului. `null` când `to` e `null`. */
  actionKey: string | null;
}

/** Codurile stabile trimise de backend (`app/core/errors.py`). */
const DUPA_COD: Record<string, SwipeBlockKind> = {
  humor_required: 'humor',
  photos_required: 'photos',
  profile_incomplete: 'profile',
  underage: 'underage',
  interaction_blocked: 'blocked',
  self_swipe: 'self',
};

/**
 * Plasă pentru serverele care încă nu trimit codul. Potrivire pe fragmente fără
 * diacritice, nu pe fraza întreagă: o virgulă schimbată nu trebuie să ne rupă.
 */
const DUPA_TEXT: [RegExp, SwipeBlockKind][] = [
  [/umor/i, 'humor'],
  [/poze/i, 'photos'],
  [/complet/i, 'profile'],
  [/ani/i, 'underage'],
  [/blocat/i, 'blocked'],
  [/propriul/i, 'self'],
];

const DESTINATII: Record<SwipeBlockKind, string | null> = {
  humor: HUMOR_PATH,
  photos: PROFILE_PATH,
  profile: ONBOARDING_PROFILE_PATH,
  underage: null,
  blocked: null,
  self: null,
  unknown: PROFILE_PATH,
};

function faraDiacritice(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Extrage codul şi textul dintr-o eroare axios, fără să presupună forma. */
function citesteRaspuns(error: unknown): { status?: number; code?: string; detail?: string } {
  const raspuns = (error as { response?: { status?: number; data?: unknown } })?.response;
  const corp = raspuns?.data as { code?: unknown; detail?: unknown } | undefined;
  return {
    status: raspuns?.status,
    code: typeof corp?.code === 'string' ? corp.code : undefined,
    detail: typeof corp?.detail === 'string' ? corp.detail : undefined,
  };
}

/**
 * Clasifică un refuz de swipe. Întoarce `null` dacă eroarea NU e un refuz de
 * autorizare — acolo mesajul de reîncercare existent rămâne răspunsul corect.
 */
export function clasificaRefuzul(error: unknown): SwipeBlock | null {
  const { status, code, detail } = citesteRaspuns(error);
  if (status !== 403) return null;

  let kind: SwipeBlockKind | undefined = code ? DUPA_COD[code] : undefined;

  if (!kind && detail) {
    const curat = faraDiacritice(detail);
    kind = DUPA_TEXT.find(([tipar]) => tipar.test(curat))?.[1];
  }

  const final: SwipeBlockKind = kind ?? 'unknown';
  const to = DESTINATII[final];

  return {
    kind: final,
    to,
    titleKey: `feed.blocked.${final}.title`,
    bodyKey: `feed.blocked.${final}.body`,
    actionKey: to ? `feed.blocked.${final}.action` : null,
  };
}
