/**
 * Secțiunea de fidelitate a ecranului Flirt Passport: cererea, stările ei și
 * cardul de progres.
 *
 * STĂRILE SUNT ONESTE ȘI SEPARATE:
 *   - se încarcă        → un indicator, nu un card gol care apoi sare;
 *   - fără rețea        → „verifică internetul", cu reîncercare;
 *   - eroare de server  → „încearcă mai târziu", cu reîncercare;
 *   - program neconfigurat (`tiers: []`) → NIMIC. Backendul poate rula fără
 *     nicio treaptă (lista goală înseamnă explicit „program oprit", vezi
 *     `TiersIn` din `backend/app/schemas/loyalty.py`), iar atunci un card care
 *     anunță „treapta ta: niciuna" ar inventa o funcție care nu există.
 *
 * Secțiunea NU golește niciodată ecranul de ștampile: o eroare aici înlocuiește
 * doar cardul ei, restul passportului rămâne pe loc.
 */
import { useTranslation } from 'react-i18next';

import { classifyLoadError, loadErrorKey } from './loyaltyErrors';
import { LoyaltyProgress } from './LoyaltyProgress';
import { useLoyaltyStatus } from './useLoyalty';

import './loyalty.css';

export function LoyaltySection() {
  const { t } = useTranslation(['screens', 'common']);
  const { data, isPending, isError, error, refetch, isFetching } = useLoyaltyStatus();

  if (isPending) {
    return (
      <div className="ly-state" data-testid="loyalty-loading">
        <div className="spinner" role="status" aria-label={t('screens:loyalty.title')} />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="ly-state" data-testid="loyalty-error">
        <p className="error-text">{t(loadErrorKey(classifyLoadError(error)))}</p>
        <button
          type="button"
          className="button button--ghost"
          disabled={isFetching}
          onClick={() => void refetch()}
          data-testid="loyalty-retry"
        >
          {t('common:actions.retry')}
        </button>
      </div>
    );
  }

  // Program neconfigurat pe server: `LoyaltyProgress` întoarce `null`, deci nu
  // desenăm nici titlul secțiunii — altfel ar rămâne un antet fără conținut.
  if (data.tiers.length === 0) return null;

  return (
    <section className="ly-section" data-testid="loyalty-section">
      <h2 className="ly-section__title">{t('screens:loyalty.title')}</h2>
      <LoyaltyProgress status={data} />
    </section>
  );
}

export default LoyaltySection;
