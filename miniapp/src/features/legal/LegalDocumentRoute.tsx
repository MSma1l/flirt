/**
 * Ruta cititorului: `DeepScreen` (antet cu ÎNAPOI) + documentul din `:doc`.
 * Folosită și în aplicație, și în poarta de consimțământ.
 */
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { DeepScreen } from '@/components/DeepScreen';

import { isLegalDocumentKind } from './legalApi';
import { LegalDocumentScreen } from './LegalDocumentScreen';

export function LegalDocumentRoute({ fallbackPath }: { fallbackPath?: string }) {
  const { t } = useTranslation('screens');
  const { doc } = useParams();
  const title = isLegalDocumentKind(doc) ? t(`legal.docTitle.${doc}`) : undefined;
  return (
    <DeepScreen title={title}>
      <LegalDocumentScreen fallbackPath={fallbackPath} />
    </DeepScreen>
  );
}

export default LegalDocumentRoute;
