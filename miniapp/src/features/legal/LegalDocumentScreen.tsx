/**
 * Cititorul unui document legal (Politica de confidențialitate, Termenii,
 * Consimțământul), în limba activă a interfeței.
 *
 * Folosit în două locuri: în aplicație (sub bara de taburi, prin `DeepScreen`)
 * și în poarta de consimțământ (fără bara de taburi). Documentul se alege din
 * proprietatea `doc` sau, lipsind ea, din parametrul de rută `:doc`.
 */
import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router';

import { StatusScreen } from '@/components/StatusScreen';

import { isLegalDocumentKind, type LegalDocumentKind } from './legalApi';
import { LEGAL_HUB_PATH } from './legalRoutes';
import { Markdown } from './Markdown';
import { useLegalDocument, useLegalLanguage } from './useLegal';

import './legal.css';

/** `2026-08-23` → data locală, fără decalaj de fus orar. */
export function formatEffectiveDate(value: string, lang: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  try {
    return date.toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return value;
  }
}

function DocumentReader({ doc }: { doc: LegalDocumentKind }) {
  const { t } = useTranslation('screens');
  const lang = useLegalLanguage();
  const query = useLegalDocument(doc);

  if (query.isLoading) {
    return (
      <StatusScreen
        loading
        logo={false}
        testId="legal-doc-loading"
        title={t('legal.loading')}
      />
    );
  }

  if (query.isError || !query.data) {
    return (
      <StatusScreen
        logo={false}
        testId="legal-doc-error"
        title={t('legal.loadError')}
        actions={[
          {
            label: t('legal.retry'),
            testId: 'legal-doc-retry',
            onClick: () => void query.refetch(),
          },
        ]}
      />
    );
  }

  const data = query.data;
  return (
    <article className="legal-reader" data-testid={`legal-doc-${doc}`}>
      <p className="legal-reader__meta" data-testid="legal-doc-meta">
        {t('legal.versionLine', {
          version: data.version,
          date: formatEffectiveDate(data.effective_date, lang),
        })}
      </p>
      <Markdown source={data.content} />
    </article>
  );
}

export function LegalDocumentScreen({
  doc,
  fallbackPath = LEGAL_HUB_PATH,
}: {
  doc?: LegalDocumentKind;
  /** Unde ducem o cale cu un document necunoscut. */
  fallbackPath?: string;
}) {
  const params = useParams();
  const resolved = doc ?? params.doc;
  if (!isLegalDocumentKind(resolved)) return <Navigate to={fallbackPath} replace />;
  return <DocumentReader doc={resolved} />;
}

export default LegalDocumentScreen;
