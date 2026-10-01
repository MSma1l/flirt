/**
 * Badge-ul de compatibilitate: o pastilă de sticlă cu un inel de progres și o
 * inimă, peste poză, în dreapta sus.
 *
 * Pragurile și culoarea vin din `mobile/src/features/feed/compat.ts` — funcții
 * pure, REUTILIZATE ca atare. Truc: `compatColor` primește un obiect de culori
 * și întoarce una dintre valorile lui; îi dăm `cssVarColors`, unde fiecare
 * valoare e `var(--color-…)`, deci primim înapoi o variabilă CSS validă, fără să
 * duplicăm pragurile.
 *
 * LIZIBILITATE PE ORICE POZĂ: fundalul pastilei e întunecat și translucid, cu
 * blur pe ce e dedesubt, iar textul e alb. Culoarea nivelului rămâne doar pe
 * inel — semnal, nu suport pentru text (galbenul pe o poză deschisă era ilizibil).
 *
 * `compatLabel` întoarce o CHEIE din namespace-ul `feed` al cataloagelor mobile,
 * nu text: o traducem aici. Înainte, eticheta accesibilă ieșea „compat.good: 66%".
 */
import { useTranslation } from 'react-i18next';

import { compatColor, compatLabel } from '@mobile/features/feed/compat';

import { cssVarColors } from '@/theme/tokens';

interface Props {
  score: number;
}

const RING_RADIUS = 9;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

export function CompatBadge({ score }: Props) {
  const { t } = useTranslation('feed');
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const color = compatColor(clamped, cssVarColors);
  const level = t(compatLabel(clamped));

  return (
    <div
      className="compat-badge"
      data-testid="compat-badge"
      role="img"
      aria-label={t('compat.badge', { level, score: clamped })}
      style={{ '--compat-color': color } as React.CSSProperties}
    >
      <svg className="compat-badge__ring" viewBox="0 0 24 24" aria-hidden="true">
        <circle className="compat-badge__track" cx="12" cy="12" r={RING_RADIUS} />
        <circle
          className="compat-badge__arc"
          cx="12"
          cy="12"
          r={RING_RADIUS}
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - clamped / 100)}
        />
        <path
          className="compat-badge__heart"
          d="M12 15.6s-3.4-2.1-3.4-4.3c0-1 .8-1.8 1.8-1.8.7 0 1.3.4 1.6 1 .3-.6.9-1 1.6-1 1 0 1.8.8 1.8 1.8 0 2.2-3.4 4.3-3.4 4.3z"
        />
      </svg>
      <span className="compat-badge__value" aria-hidden="true">
        {clamped}%
      </span>
    </div>
  );
}
