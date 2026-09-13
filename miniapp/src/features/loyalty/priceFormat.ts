/**
 * Formatarea unei sume primite de la server.
 *
 * NU calculează nimic — primește un număr gata calculat și îl scrie în limba
 * interfeței. Aceeași regulă ca `features/events/eventFormat.ts`: funcțiile nu
 * sunt componente, deci citesc limba din instanța globală `i18n`.
 *
 * Zecimalele: maximum două, dar niciuna forțată. Prețurile din `Event.ticket_price`
 * sunt de regulă rotunde (250), iar „250,00" adaugă zgomot; când reducerea dă
 * 199.99, cei doi bani se văd.
 */
import i18n from '@/i18n';

/** Suma, scrisă cu separatorii limbii curente. */
export function formatAmount(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  try {
    return new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(safe);
  } catch {
    // Limbă necunoscută pentru `Intl` — mai bine cifra brută decât o excepție.
    return String(safe);
  }
}

/**
 * Suma + moneda, în ordinea folosită peste tot în aplicație („250 lei").
 * Moneda vine de la server (`Event.ticket_currency`), deci nu se traduce.
 */
export function formatPrice(value: number, currency: string): string {
  return `${formatAmount(value)} ${currency}`;
}
