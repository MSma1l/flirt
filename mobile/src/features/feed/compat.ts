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

/** Etichetă text pentru nivelul de compatibilitate. */
export function compatLabel(score: number): string {
  if (score > 80) return 'Potrivire excelentă';
  if (score >= 50) return 'Potrivire bună';
  return 'Potrivire slabă';
}
