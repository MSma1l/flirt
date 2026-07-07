/** Tipuri pentru fluxul de raportare utilizator (TZ 5.5). Câmpuri în camelCase. */

/** Categoriile de raportare acceptate de backend. */
export type ReportCategory = 'spam' | 'fake' | 'offensive' | 'obscene';

/** Datele necesare pentru a trimite un raport. */
export interface ReportInput {
  /** Id-ul utilizatorului raportat. */
  reportedUserId: string;
  /** Categoria selectată. */
  category: ReportCategory;
  /** Id-ul dialogului din care se raportează (opțional). */
  chatId?: string;
  /** Notă liberă opțională. */
  note?: string;
}
