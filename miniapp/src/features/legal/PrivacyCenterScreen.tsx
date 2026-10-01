/**
 * Centrul „Confidențialitate și date": documentele legale, copia datelor
 * (dreptul de acces / portabilitate), consimțământul pentru selfie (retragere)
 * și drumul spre ștergerea contului.
 *
 * DESCĂRCAREA ÎN WEBVIEW-UL TELEGRAM: un `<a download>` cu Blob merge în
 * browser și pe Telegram Desktop, dar unele clienți mobili îl ignoră. De aceea,
 * după ce datele sosesc, le păstrăm și oferim și „Copiază" — utilizatorul are
 * mereu o cale de a-și lua datele, chiar dacă descărcarea nu e permisă.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Icon } from '@/components/icons';
import { SETTINGS_PATH } from '@/features/onboarding/paths';

import {
  EXPORT_FILE_NAME,
  fetchMyDataExport,
  LEGAL_DOCUMENTS,
  withdrawConsent,
} from './legalApi';
import { legalDocPath } from './legalRoutes';
import { formatEffectiveDate } from './LegalDocumentScreen';
import { CONSENT_STATUS_KEY, useConsentStatus, useLegalLanguage } from './useLegal';

import './legal.css';

/** Încearcă să salveze fișierul JSON. `false` dacă mediul nu permite. */
export function saveJsonFile(text: string, fileName = EXPORT_FILE_NAME): boolean {
  try {
    if (typeof URL.createObjectURL !== 'function') return false;
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* cade mai jos */
  }
  return false;
}

export function PrivacyCenterScreen() {
  const { t } = useTranslation('screens');
  const lang = useLegalLanguage();
  const queryClient = useQueryClient();
  const statusQuery = useConsentStatus();

  const [exportText, setExportText] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);

  const exportMutation = useMutation({
    mutationFn: fetchMyDataExport,
    onSuccess: (text) => {
      setExportText(text);
      setCopied(null);
      saveJsonFile(text);
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: () => withdrawConsent(['sensitive_data']),
    onSuccess: (status) => queryClient.setQueryData(CONSENT_STATUS_KEY, status),
  });

  const sensitive = statusQuery.data?.accepted?.sensitive_data ?? null;
  const sensitiveGiven = statusQuery.data?.sensitive_data_consent === true;

  return (
    <div className="privacy-center" data-testid="privacy-center">
      <p className="body-text privacy-center__lead">{t('legal.center.lead')}</p>

      {/* ── Documente ─────────────────────────────────────────────────── */}
      <section className="settings-section">
        <h2 className="settings-section__title">{t('legal.center.documents')}</h2>
        <nav className="more-list" aria-label={t('legal.center.documents')}>
          {LEGAL_DOCUMENTS.map((doc) => (
            <Link
              key={doc}
              to={legalDocPath(doc)}
              className="more-item"
              data-testid={`privacy-center-doc-${doc}`}
            >
              <span className="more-item__label">{t(`legal.docTitle.${doc}`)}</span>
              <Icon name="chevron" className="more-item__chevron" />
            </Link>
          ))}
        </nav>
      </section>

      {/* ── Datele mele ───────────────────────────────────────────────── */}
      <section className="settings-section">
        <h2 className="settings-section__title">{t('legal.center.myData')}</h2>
        <p className="caption">{t('legal.center.exportHint')}</p>
        <button
          type="button"
          className="button button--ghost"
          disabled={exportMutation.isPending}
          onClick={() => exportMutation.mutate()}
          data-testid="export-data"
        >
          {exportMutation.isPending ? t('legal.center.exporting') : t('legal.center.export')}
        </button>
        {exportMutation.isError ? (
          <p className="error-text" role="alert" data-testid="export-error">
            {t('legal.center.exportError')}
          </p>
        ) : null}
        {exportText ? (
          <div className="settings-banner" data-testid="export-ready">
            <p className="settings-banner__title">{t('legal.center.exportReady')}</p>
            <p className="caption">{t('legal.center.exportReadyHint')}</p>
            <div className="privacy-center__row">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => saveJsonFile(exportText)}
                data-testid="export-save"
              >
                {t('legal.center.save')}
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => void copyText(exportText).then(setCopied)}
                data-testid="export-copy"
              >
                {t('legal.center.copy')}
              </button>
            </div>
            {copied === true ? (
              <p className="caption" role="status" data-testid="export-copied">
                {t('legal.center.copied')}
              </p>
            ) : null}
            {copied === false ? (
              <p className="error-text" role="alert">
                {t('legal.center.copyFailed')}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* ── Consimțăminte ─────────────────────────────────────────────── */}
      {statusQuery.data ? (
        <section className="settings-section" data-testid="privacy-center-consents">
          <h2 className="settings-section__title">{t('legal.center.consents')}</h2>
          <p className="caption">
            {t('legal.center.mainConsent', {
              version: statusQuery.data.accepted?.privacy?.version ?? '—',
            })}
          </p>
          <p className="body-text">{t('legal.center.sensitiveTitle')}</p>
          {sensitiveGiven && sensitive ? (
            <>
              <p className="caption" data-testid="sensitive-given">
                {t('legal.center.sensitiveGiven', {
                  date: formatEffectiveDate(sensitive.accepted_at, lang),
                })}
              </p>
              <button
                type="button"
                className="button button--ghost"
                disabled={withdrawMutation.isPending}
                onClick={() => withdrawMutation.mutate()}
                data-testid="withdraw-sensitive"
              >
                {t('legal.center.withdraw')}
              </button>
            </>
          ) : (
            <p className="caption" data-testid="sensitive-not-given">
              {t('legal.center.sensitiveNotGiven')}
            </p>
          )}
          {withdrawMutation.isError ? (
            <p className="error-text" role="alert">
              {t('legal.center.withdrawError')}
            </p>
          ) : null}
          <p className="caption">{t('legal.center.withdrawMainHint')}</p>
        </section>
      ) : null}

      {/* ── Ștergere + drepturi ───────────────────────────────────────── */}
      <section className="settings-section">
        <h2 className="settings-section__title">{t('legal.center.rightsTitle')}</h2>
        <p className="caption">{t('legal.center.rightsBody')}</p>
        <Link to={SETTINGS_PATH} className="button pf-button--danger" data-testid="privacy-center-delete">
          {t('legal.center.deleteAccount')}
        </Link>
      </section>
    </div>
  );
}

export default PrivacyCenterScreen;
