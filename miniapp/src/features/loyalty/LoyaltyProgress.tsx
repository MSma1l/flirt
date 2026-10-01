/**
 * Treapta curentă, reducerea ei și CÂT MAI E până la următoarea.
 *
 * DE CE e partea cea mai importantă a ecranului: o colecție de ștampile fără
 * orizont nu e un program de fidelitate, e un album. Singurul lucru care face
 * oamenii să se întoarcă e să vadă că mai au două ștampile până la ceva anume,
 * cu numele lui și cu procentul lui scris.
 *
 * PE ULTIMA TREAPTĂ NU DESENĂM BARĂ. O bară care nu se mai umple niciodată
 * arată ca o promisiune neonorată; acolo spunem simplu că e treapta maximă și
 * care e reducerea câștigată.
 *
 * PROGRAM NECONFIGURAT (`tiers: []`, adică adminul nu a pus nicio treaptă):
 * componenta nu randează NIMIC. Un card care spune „treapta ta: niciuna" într-o
 * aplicație fără trepte e zgomot pur.
 *
 * Procentele și pragurile vin toate de pe server. Aici se calculează un singur
 * număr, și acela e pur vizual: lățimea barei. Nu atinge banii.
 */
import { useTranslation } from 'react-i18next';

import type { LoyaltyStatus } from './loyaltyApi';

import './loyalty.css';

/**
 * Cât din drumul dintre treapta curentă și următoarea e parcurs, în procente.
 * Punctul de plecare e pragul treptei ATINSE (0 dacă nu are niciuna), ca bara
 * să nu pornească de la zero absolut la fiecare treaptă nouă — altfel un om cu
 * 9 ștampile din 10 ar vedea bara aproape goală imediat după ce a avansat.
 */
export function progressPercent(status: LoyaltyStatus): number {
  const { nextTier, tier, stamps } = status;
  if (!nextTier) return 100;
  const from = tier?.minStamps ?? 0;
  const span = nextTier.minStamps - from;
  if (span <= 0) return 100;
  const done = ((stamps - from) / span) * 100;
  return Math.max(0, Math.min(100, Math.round(done)));
}

/**
 * Metalul cardului, ghicit din numele treptei (setat de admin, în orice limbă).
 * E pur decorativ: un nume necunoscut primește finisajul de brand, nu o eroare.
 */
export type TierMetal = 'bronze' | 'silver' | 'gold' | 'platinum' | 'brand';

const METAL_HINTS: readonly [TierMetal, readonly string[]][] = [
  ['platinum', ['platin', 'diamond', 'diamant', 'бриллиант', 'платин', 'vip']],
  ['gold', ['gold', 'aur', 'золот']],
  ['silver', ['silver', 'argint', 'серебр']],
  ['bronze', ['bronz', 'бронз']],
];

export function tierMetal(name: string | null | undefined): TierMetal {
  const lower = (name ?? '').toLowerCase();
  const hit = METAL_HINTS.find(([, hints]) => hints.some((hint) => lower.includes(hint)));
  return hit ? hit[0] : 'brand';
}

/** Emblema cardului: o stea fațetată, colorată de metalul treptei. */
function TierEmblem() {
  return (
    <span className="ly-emblem" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22">
        <path
          d="M12 2.5l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.2 6.1-.7z"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}

/** Cardul treptei: numele, reducerea și progresul. Pur prezentațional. */
export function LoyaltyProgress({ status }: { status: LoyaltyStatus }) {
  const { t } = useTranslation('screens');

  // Fără trepte configurate nu există program de fidelitate de arătat.
  if (status.tiers.length === 0) return null;

  const { tier, nextTier, stamps, stampsToNextTier, discountPercent } = status;
  const percent = progressPercent(status);
  const atMaxTier = nextTier === null;
  // Fără treaptă încă, cardul poartă deja culoarea celei spre care mergi.
  const metal = tierMetal(tier?.name ?? nextTier?.name);

  return (
    <div className="ly-card" data-testid="loyalty-progress" data-metal={metal}>
      <div className="ly-card__sheen" aria-hidden="true" />
      <div className="ly-card__brand">
        <span className="ly-card__eyebrow">{t('settings:links.passport')}</span>
        <TierEmblem />
      </div>
      <div className="ly-card__head">
        <span className="ly-card__tier" data-testid="loyalty-tier">
          {tier
            ? t('loyalty.tierLabel', { tier: tier.name })
            : t('loyalty.noTier')}
        </span>
        {discountPercent > 0 ? (
          <span className="ly-card__discount" data-testid="loyalty-discount">
            {t('loyalty.tierDiscount', { percent: discountPercent })}
          </span>
        ) : null}
      </div>

      <p className="ly-card__stamps" data-testid="loyalty-stamps">
        {t('loyalty.stampsCount', { count: stamps })}
      </p>

      {atMaxTier ? (
        <p className="ly-card__max" data-testid="loyalty-max-tier">
          {t('loyalty.maxTier')}
        </p>
      ) : (
        <div className="ly-progress" data-testid="loyalty-next">
          <div
            className="ly-progress__track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={t('loyalty.progressLabel', { tier: nextTier.name })}
          >
            <div className="ly-progress__fill" style={{ width: `${percent}%` }}>
              <span className="ly-progress__shine" aria-hidden="true" />
            </div>
          </div>
          <p className="ly-progress__text">
            {t('loyalty.toNext', { count: stampsToNextTier ?? 0 })}
          </p>
          <p className="ly-progress__reward">
            {t('loyalty.nextReward', {
              tier: nextTier.name,
              percent: nextTier.discountPercent,
            })}
          </p>
        </div>
      )}
    </div>
  );
}

export default LoyaltyProgress;
