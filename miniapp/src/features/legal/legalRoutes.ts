/**
 * Căile ecranelor legale.
 *
 * Două seturi, intenționat separate:
 *  - în aplicație (cu bara de taburi): centrul de confidențialitate și cititorul;
 *  - în poarta de consimțământ (fără bara de taburi, înaintea înregistrării).
 */
import type { LegalDocumentKind } from './legalApi';

/** Centrul „Confidențialitate și date" (meniu → aici). */
export const LEGAL_HUB_PATH = '/legal';
/** Cititorul unui document, în aplicație: `/legal/privacy`, `/legal/terms`, `/legal/consent`. */
export const LEGAL_DOC_ROUTE_PATTERN = '/legal/:doc';

/** Poarta de consimțământ și cititorul ei. */
export const CONSENT_PATH = '/consent';
export const CONSENT_DOC_ROUTE_PATTERN = '/consent/:doc';

export function legalDocPath(doc: LegalDocumentKind): string {
  return `${LEGAL_HUB_PATH}/${doc}`;
}

export function consentDocPath(doc: LegalDocumentKind): string {
  return `${CONSENT_PATH}/${doc}`;
}
