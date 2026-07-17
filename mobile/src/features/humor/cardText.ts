/**
 * Alegerea textului unui card de umor după limba activă.
 *
 * Serverul trimite gluma în toate cele 4 limbi (`text_ro/ru/uk/en`); noi alegem
 * varianta limbii curente. Regula de aur: NICIODATĂ text gol pe ecran — dacă
 * varianta cerută lipsește (server mai vechi, traducere neintrodusă încă), cădem
 * pe română, apoi pe aliasul `text`. Un card fără niciun text ar fi date stricate
 * de la server, nu o stare pe care userul s-o poată provoca.
 */
import { DEFAULT_LANGUAGE, type Language } from '@/i18n/config';

import { HumorCard } from './types';

/** Prima valoare non-goală (după trim) dintr-o listă de candidați. */
function firstNonEmpty(...candidates: (string | undefined)[]): string {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

/**
 * Textul cardului în limba cerută, cu fallback pe `ro`.
 *
 * ```ts
 * const { current } = useLanguage();
 * cardText(card, current);
 * ```
 */
export function cardText(card: HumorCard, language: Language): string {
  return firstNonEmpty(
    card[`text_${language}`],
    card[`text_${DEFAULT_LANGUAGE}`],
    card.text,
  );
}
