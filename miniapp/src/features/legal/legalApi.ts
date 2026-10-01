/**
 * Accesul la documentele legale și la consimțăminte (Legea nr. 195/2024, GDPR).
 *
 * Backend (`/api/v1/legal/*`):
 *   GET  /legal/documents/{doc}?lang=   — textul versionat (markdown) al documentului;
 *   GET  /legal/consent-status          — ce versiuni sunt în vigoare și ce a acceptat userul;
 *   POST /legal/consent                 — înregistrează acceptarea (cu IP/UA pe server);
 *   POST /legal/consent/withdraw        — retrage un consimțământ OPȚIONAL (sensitive_data);
 *   GET  /me/export                     — copia datelor personale (portabilitate / acces).
 *
 * Textul se servește de pe server, deci poate fi actualizat fără o nouă versiune
 * a Mini App-ului; aici nu există nicio copie locală a documentelor.
 */
import { api } from '@/api/client';

/** Documentele afișabile. `consent` = textul consimțământului pentru prelucrare. */
export type LegalDocumentKind = 'privacy' | 'terms' | 'consent';

/** Documentele pentru care se înregistrează un consimțământ. */
export type ConsentDocument = 'terms' | 'privacy' | 'sensitive_data';

export const LEGAL_DOCUMENTS: readonly LegalDocumentKind[] = ['privacy', 'terms', 'consent'];

export function isLegalDocumentKind(value: unknown): value is LegalDocumentKind {
  return typeof value === 'string' && (LEGAL_DOCUMENTS as readonly string[]).includes(value);
}

export interface LegalDocument {
  document: LegalDocumentKind;
  lang: string;
  version: string;
  effective_date: string;
  title: string;
  content: string;
  missing_placeholders?: string[];
}

export interface ConsentRecord {
  version: string;
  accepted_at: string;
  withdrawn_at: string | null;
}

export interface ConsentStatus {
  consent_required: boolean;
  required_documents: ConsentDocument[];
  current_versions: Partial<Record<ConsentDocument, string>>;
  accepted: Partial<Record<ConsentDocument, ConsentRecord | null>>;
  sensitive_data_consent: boolean;
}

export async function fetchLegalDocument(
  doc: LegalDocumentKind,
  lang: string,
): Promise<LegalDocument> {
  const { data } = await api.get<LegalDocument>(`/legal/documents/${doc}`, {
    params: { lang },
  });
  return data;
}

export async function fetchConsentStatus(): Promise<ConsentStatus> {
  const { data } = await api.get<ConsentStatus>('/legal/consent-status');
  return data;
}

/**
 * Acceptă documentele date, la versiunile ÎN VIGOARE primite de la server.
 * Trimitem doar versiunile documentelor bifate — serverul compară și întoarce
 * 409 dacă între timp a apărut o versiune nouă.
 */
export async function acceptConsent(
  documents: ConsentDocument[],
  currentVersions: ConsentStatus['current_versions'],
): Promise<ConsentStatus> {
  const versions: Partial<Record<ConsentDocument, string>> = {};
  for (const doc of documents) {
    const version = currentVersions[doc];
    if (version) versions[doc] = version;
  }
  const { data } = await api.post<ConsentStatus>('/legal/consent', { documents, versions });
  return data;
}

export async function withdrawConsent(documents: ConsentDocument[]): Promise<ConsentStatus> {
  const { data } = await api.post<ConsentStatus>('/legal/consent/withdraw', { documents });
  return data;
}

/** Numele fișierului descărcat — același cu cel din `Content-Disposition`. */
export const EXPORT_FILE_NAME = 'flirt-data-export.json';

/** Copia datelor, ca text JSON frumos formatat (gata de salvat sau copiat). */
export async function fetchMyDataExport(): Promise<string> {
  const { data } = await api.get<unknown>('/me/export');
  return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}
