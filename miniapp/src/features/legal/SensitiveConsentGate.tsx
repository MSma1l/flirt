/**
 * Consimțământul EXPLICIT pentru datele sensibile (selfie de verificare,
 * biometric — art. 9(2)(a) GDPR / Legea nr. 195/2024), cerut chiar înainte de
 * fluxul de captură.
 *
 * Dacă starea consimțămintelor nu se poate citi (server vechi, rețea), NU
 * blocăm: serverul verifică oricum consimțământul la `POST /profiles/verify-face`
 * și răspunde 403, iar ecranul de verificare recitește atunci starea.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { StatusScreen } from '@/components/StatusScreen';

import { acceptConsent } from './legalApi';
import { legalDocPath } from './legalRoutes';
import { CONSENT_STATUS_KEY, useConsentStatus } from './useLegal';

import './legal.css';

export function SensitiveConsentGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation('screens');
  const queryClient = useQueryClient();
  const statusQuery = useConsentStatus();
  const [checked, setChecked] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      acceptConsent(['sensitive_data'], statusQuery.data?.current_versions ?? {}),
    onSuccess: (status) => queryClient.setQueryData(CONSENT_STATUS_KEY, status),
    onError: () => void statusQuery.refetch(),
  });

  if (statusQuery.isLoading) {
    return (
      <StatusScreen loading logo={false} testId="sensitive-consent-loading" title={t('legal.loading')} />
    );
  }

  if (statusQuery.isError || !statusQuery.data || statusQuery.data.sensitive_data_consent) {
    return <>{children}</>;
  }

  return (
    <div className="consent-card sensitive-consent" data-testid="sensitive-consent-card">
      <h2 className="consent-card__title">{t('legal.sensitive.title')}</h2>
      <p className="body-text">{t('legal.sensitive.body')}</p>
      <ul className="consent-summary">
        <li>{t('legal.sensitive.pointWhat')}</li>
        <li>{t('legal.sensitive.pointStorage')}</li>
        <li>{t('legal.sensitive.pointWithdraw')}</li>
      </ul>
      <Link to={legalDocPath('consent')} className="consent-link" data-testid="sensitive-open-consent">
        {t('legal.docTitle.consent')}
      </Link>
      <label className="consent-check">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          data-testid="sensitive-consent-check"
        />
        <span className="consent-check__text">{t('legal.sensitive.check')}</span>
      </label>
      {mutation.isError ? (
        <p className="error-text" role="alert" data-testid="sensitive-consent-error">
          {t('legal.consent.error')}
        </p>
      ) : null}
      <button
        type="button"
        className="button button--wide"
        disabled={!checked || mutation.isPending}
        onClick={() => mutation.mutate()}
        data-testid="sensitive-consent-continue"
      >
        {t('legal.sensitive.continue')}
      </button>
    </div>
  );
}

export default SensitiveConsentGate;
