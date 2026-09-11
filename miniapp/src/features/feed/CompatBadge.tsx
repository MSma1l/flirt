/**
 * Badge-ul de compatibilitate. Pragurile și culoarea vin din
 * `mobile/src/features/feed/compat.ts` — funcții pure, REUTILIZATE ca atare.
 *
 * Truc: `compatColor` primește un obiect de culori și întoarce una dintre
 * valorile lui. Îi dăm `cssVarColors`, unde fiecare valoare e `var(--color-…)`,
 * deci primim înapoi o variabilă CSS validă, fără să duplicăm pragurile.
 */
import { compatColor, compatLabel } from '@mobile/features/feed/compat';

import { cssVarColors } from '@/theme/tokens';

interface Props {
  score: number;
}

export function CompatBadge({ score }: Props) {
  return (
    <div
      className="compat-badge"
      style={{ backgroundColor: compatColor(score, cssVarColors) }}
      // `compatLabel` întoarce text românesc: eticheta nu e încă în cataloagele
      // i18n ale aplicației mobile, iar sarcina interzice modificarea lor.
      aria-label={`${compatLabel(score)}: ${score}%`}
      role="img"
    >
      {score}%
    </div>
  );
}
