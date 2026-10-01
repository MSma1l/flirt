/**
 * POARTA DE CONSIMȚĂMÂNT — primul ecran după autentificarea Telegram, înaintea
 * înregistrării și a oricărui conținut (Legea nr. 195/2024, aliniată la GDPR).
 *
 * Reguli:
 *  - două bife OBLIGATORII, nebifate implicit: 18+ și Termenii; prelucrarea
 *    datelor conform Politicii de confidențialitate. „Continuă" rămâne inactiv
 *    până sunt bifate amândouă — consimțământul trebuie să fie un act activ;
 *  - o bifă OPȚIONALĂ, separată, pentru datele sensibile (selfie de verificare,
 *    biometric) — doar dacă funcția există pe server. Refuzul nu blochează nimic;
 *  - textele complete se citesc în aplicație, fără bara de taburi;
 *  - se trimit versiunile ÎN VIGOARE primite de la server; dacă între timp a
 *    apărut o versiune nouă (409), reîncărcăm starea și cerem o nouă confirmare.
 *
 * După acceptare, actualizăm `consent_required` din `/auth/me` (cache-ul React
 * Query), iar poarta din `routes.tsx` se deschide singură.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { BrandLogo } from '@/components/BrandLogo';
import { StatusScreen } from '@/components/StatusScreen';
import { CAPABILITY, useCapability } from '@/features/capabilities';
import { CURRENT_USER_KEY, type CurrentUser } from '@/features/onboarding/useCurrentUser';
import { haptic } from '@/telegram/bridge';

import { acceptConsent, type ConsentDocument, type ConsentStatus } from './legalApi';
import { consentDocPath } from './legalRoutes';
import { CONSENT_STATUS_KEY, useConsentStatus } from './useLegal';

import './legal.css';

/** Ce rezumăm pe ecran (cheile din `screens:legal.consent.summary.*`). */
const SUMMARY_KEYS = ['profile', 'location', 'chat', 'events', 'rights'] as const;

function Checkbox({
  checked,
  onChange,
  testId,
  children,
  optional,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  testId: string;
  children: ReactNode;
  optional?: boolean;
}) {
  return (
    <label className={`consent-check${optional ? ' consent-check--optional' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testId}
      />
      <span className="consent-check__text">{children}</span>
    </label>
  );
}

export function ConsentScreen() {
  const { t } = useTranslation('screens');
  const queryClient = useQueryClient();
  const statusQuery = useConsentStatus();
  const faceVerification = useCapability(CAPABILITY.faceVerification);

  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [acceptSensitive, setAcceptSensitive] = useState(false);
  const [stale, setStale] = useState(false);

  const mutation = useMutation({
    mutationFn: ({
      documents,
      versions,
    }: {
      documents: ConsentDocument[];
      versions: ConsentStatus['current_versions'];
    }) => acceptConsent(documents, versions),
    onSuccess: (status) => {
      queryClient.setQueryData(CONSENT_STATUS_KEY, status);
      queryClient.setQueryData<CurrentUser>(CURRENT_USER_KEY, (old) =>
        old ? { ...old, consent_required: status.consent_required } : old,
      );
      void queryClient.invalidateQueries({ queryKey: CURRENT_USER_KEY });
    },
    onError: (error) => {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        // O versiune nouă a apărut între timp: o aducem și cerem o nouă confirmare.
        setStale(true);
        setAcceptTerms(false);
        setAcceptPrivacy(false);
        void statusQuery.refetch();
      }
    },
  });

  if (statusQuery.isLoading) {
    return (
      <StatusScreen loading testId="consent-loading" title={t('legal.loading')} />
    );
  }

  if (statusQuery.isError || !statusQuery.data) {
    return (
      <StatusScreen
        testId="consent-load-error"
        title={t('legal.loadError')}
        actions={[
          {
            label: t('legal.retry'),
            testId: 'consent-retry',
            onClick: () => void statusQuery.refetch(),
          },
        ]}
      />
    );
  }

  const status = statusQuery.data;
  const canContinue = acceptTerms && acceptPrivacy && !mutation.isPending;
  const showSensitive = faceVerification.enabled;

  const submit = () => {
    if (!canContinue) return;
    haptic('medium');
    setStale(false);
    const documents: ConsentDocument[] = ['terms', 'privacy'];
    if (showSensitive && acceptSensitive) documents.push('sensitive_data');
    mutation.mutate({ documents, versions: status.current_versions });
  };

  const genericError =
    mutation.isError &&
    !(axios.isAxiosError(mutation.error) && mutation.error.response?.status === 409);

  return (
    <div className="consent-screen" data-testid="consent-screen">
      <div className="consent-hero">
        <BrandLogo width={120} />
        <h1 className="title consent-hero__title">{t('legal.consent.title')}</h1>
        <p className="body-text consent-hero__lead">{t('legal.consent.lead')}</p>
      </div>

      <section className="consent-card" aria-labelledby="consent-summary-title">
        <h2 id="consent-summary-title" className="consent-card__title">
          {t('legal.consent.summaryTitle')}
        </h2>
        <ul className="consent-summary">
          {SUMMARY_KEYS.map((key) => (
            <li key={key}>{t(`legal.consent.summary.${key}`)}</li>
          ))}
        </ul>
        <div className="consent-links">
          <Link to={consentDocPath('privacy')} className="consent-link" data-testid="consent-open-privacy">
            {t('legal.docTitle.privacy')}
          </Link>
          <Link to={consentDocPath('terms')} className="consent-link" data-testid="consent-open-terms">
            {t('legal.docTitle.terms')}
          </Link>
          <Link to={consentDocPath('consent')} className="consent-link" data-testid="consent-open-consent">
            {t('legal.docTitle.consent')}
          </Link>
        </div>
      </section>

      {stale ? (
        <p className="consent-notice" role="status" data-testid="consent-stale">
          {t('legal.consent.stale')}
        </p>
      ) : null}

      <div className="consent-checks">
        <Checkbox checked={acceptTerms} onChange={setAcceptTerms} testId="consent-terms">
          {t('legal.consent.checkTerms')}
        </Checkbox>
        <Checkbox checked={acceptPrivacy} onChange={setAcceptPrivacy} testId="consent-privacy">
          {t('legal.consent.checkPrivacy')}
        </Checkbox>
        {showSensitive ? (
          <Checkbox
            checked={acceptSensitive}
            onChange={setAcceptSensitive}
            testId="consent-sensitive"
            optional
          >
            <span className="consent-optional-badge">{t('legal.consent.optional')}</span>{' '}
            {t('legal.consent.checkSensitive')}
          </Checkbox>
        ) : null}
      </div>

      {genericError ? (
        <p className="error-text" role="alert" data-testid="consent-error">
          {t('legal.consent.error')}
        </p>
      ) : null}

      <button
        type="button"
        className="button button--wide"
        disabled={!canContinue}
        onClick={submit}
        data-testid="consent-continue"
      >
        {mutation.isPending ? t('legal.consent.saving') : t('legal.consent.continue')}
      </button>

      <p className="caption consent-footnote">{t('legal.consent.footnote')}</p>
    </div>
  );
}

export default ConsentScreen;
