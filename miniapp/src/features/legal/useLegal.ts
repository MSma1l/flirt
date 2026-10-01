/**
 * Hook-urile documentelor legale și ale consimțămintelor.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { DEFAULT_LANGUAGE, normalizeLanguage } from '@mobile/i18n/config';

import {
  fetchConsentStatus,
  fetchLegalDocument,
  type ConsentStatus,
  type LegalDocument,
  type LegalDocumentKind,
} from './legalApi';

export const CONSENT_STATUS_KEY = ['legal', 'consent-status'] as const;

export function legalDocumentKey(doc: LegalDocumentKind, lang: string) {
  return ['legal', 'document', doc, lang] as const;
}

/** Limba activă, normalizată la una din cele trei suportate. */
export function useLegalLanguage(): string {
  const { i18n } = useTranslation();
  return normalizeLanguage(i18n.language) ?? DEFAULT_LANGUAGE;
}

/** Documentul, în limba activă a interfeței (se reîncarcă la schimbarea limbii). */
export function useLegalDocument(doc: LegalDocumentKind): UseQueryResult<LegalDocument> {
  const lang = useLegalLanguage();
  return useQuery({
    queryKey: legalDocumentKey(doc, lang),
    queryFn: () => fetchLegalDocument(doc, lang),
    staleTime: 10 * 60 * 1000,
  });
}

export function useConsentStatus(enabled = true): UseQueryResult<ConsentStatus> {
  return useQuery({
    queryKey: CONSENT_STATUS_KEY,
    queryFn: fetchConsentStatus,
    enabled,
    staleTime: 60 * 1000,
  });
}
