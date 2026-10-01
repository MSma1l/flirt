/**
 * Formatări de afișare. Locale-ul urmează limba panoului (`ro-RO` implicit);
 * îl setează `LanguageProvider` la fiecare schimbare de limbă.
 */

let LOCALE = 'ro-RO';

export function setFormatLocale(locale: string): void {
  LOCALE = locale;
}

const isRussian = (): boolean => LOCALE.startsWith('ru');

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(LOCALE).format(value);
}

export function formatEur(value: number): string {
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** `2026-07-01` → `1 iul.` (etichetă de axă). */
export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' }).format(date);
}

/** Dată-timp completă, pentru tabele și detalii. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Timp relativ scurt („acum 3 h"), pentru coada de moderare. */
export function formatRelative(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  const ru = isRussian();
  if (minutes < 1) return ru ? 'сейчас' : 'acum';
  if (minutes < 60) return ru ? `${minutes} мин назад` : `acum ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return ru ? `${hours} ч назад` : `acum ${hours} h`;
  const days = Math.round(hours / 24);
  return ru ? `${days} дн назад` : `acum ${days} z`;
}

/** Valoarea pentru `<input type="datetime-local">` din ISO UTC. */
export function toDateTimeLocalValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** `datetime-local` (ora locală) → ISO UTC, forma pe care o cere backend-ul. */
export function fromDateTimeLocalValue(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}
