/** Utilitare pure pentru compatibilitate (TZ 4.2): culoare + etichetă din scor. */
import { ThemeColors } from '@theme/colors';

/**
 * Culoarea badge-ului de compatibilitate în funcție de scor:
 * - verde (`success`) dacă > 80
 * - galben (`warning`) dacă 50–80 (inclusiv)
 * - gri (`textDisabled`) dacă < 50
 */
export function compatColor(score: number, colors: ThemeColors): string {
  if (score > 80) return colors.success;
  if (score >= 50) return colors.warning;
  return colors.textDisabled;
}

/** Cheile de traducere ale nivelurilor de compatibilitate (namespace `feed`). */
export type CompatLabelKey = 'compat.excellent' | 'compat.good' | 'compat.weak';

/**
 * CHEIA etichetei pentru nivelul de compatibilitate, nu textul.
 *
 * Modul pur, apelat în afara randării, unde `t` nu există — același tipar ca
 * `features/auth/validation.ts`. Traducerea se face la afișare, în componentele
 * care arată scorul (`CompatBadge`, `ChatListItem`).
 */
export function compatLabel(score: number): CompatLabelKey {
  if (score > 80) return 'compat.excellent';
  if (score >= 50) return 'compat.good';
  return 'compat.weak';
}
