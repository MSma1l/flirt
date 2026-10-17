/**
 * Formatări de afișare. Locale-ul urmează limba panoului (`ro-RO` implicit);
 * îl setează `LanguageProvider` la fiecare schimbare de limbă.
 *
 * FUSUL ORAR e fix: `Europe/Chisinau`. Evenimentele au loc în Moldova, deci ora
 * afișată (și cea introdusă în formulare `datetime-local`) e ora din Chișinău,
 * indiferent de fusul browserului adminului (ex. un admin aflat în străinătate).
 */

let LOCALE = 'ro-RO';

/** Fusul orar al evenimentelor — toate datele din panou se arată în el. */
export const TIME_ZONE = 'Europe/Chisinau';

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
  return new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric',
    month: 'short',
    timeZone: TIME_ZONE,
  }).format(date);
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
    timeZone: TIME_ZONE,
  }).format(date);
}

/** Doar ora („21:04"), în fusul evenimentelor. */
export function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TIME_ZONE,
  }).format(date);
}

/** Ziua calendaristică (`YYYY-MM-DD`) a unui moment, în fusul evenimentelor. */
export function dayKey(value: Date | string | number): string {
  const parts = zonedParts(new Date(value).getTime());
  if (!parts) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/**
 * Suma + moneda. „lei"/„MDL" (oricum ar fi scrise) devin codul ISO `MDL`;
 * zecimalele apar doar când există („150 MDL", „12,50 MDL"). O monedă
 * necunoscută cade elegant pe „150 XYZ".
 */
export function formatMoney(amount: number, currency: string | null | undefined): string {
  const raw = (currency ?? '').trim();
  const code = /^(lei|mdl)$/i.test(raw) || raw === '' ? 'MDL' : raw.toUpperCase();
  const fraction = Number.isInteger(amount) ? 0 : 2;
  try {
    if (!/^[A-Z]{3}$/.test(code)) throw new RangeError(code);
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency: code,
      currencyDisplay: code === 'MDL' ? 'code' : 'symbol',
      minimumFractionDigits: fraction,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(amount)} ${raw}`;
  }
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

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

let partsFormatter: Intl.DateTimeFormat | null = null;

/** Ora „de perete" din Chișinău pentru un moment UTC (ms). */
function zonedParts(ms: number): ZonedParts | null {
  if (Number.isNaN(ms)) return null;
  partsFormatter ??= new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const out: Record<string, number> = {};
  for (const part of partsFormatter.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return {
    year: out.year ?? 0,
    month: out.month ?? 0,
    day: out.day ?? 0,
    // Unele motoare scriu miezul nopții ca „24".
    hour: (out.hour ?? 0) % 24,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

/** Diferența (ms) dintre ora din Chișinău și UTC, la momentul dat. */
function zoneOffsetMs(ms: number): number {
  const p = zonedParts(ms);
  if (!p) return 0;
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (ms - (((ms % 1000) + 1000) % 1000));
}

/** Valoarea pentru `<input type="datetime-local">` din ISO UTC (ora din Chișinău). */
export function toDateTimeLocalValue(iso: string): string {
  const p = zonedParts(new Date(iso).getTime());
  if (!p) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * `datetime-local` (ora din Chișinău) → ISO UTC, forma pe care o cere backend-ul.
 * Corect și la schimbarea orei (DST): offset-ul se recalculează la momentul găsit.
 */
export function fromDateTimeLocalValue(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());
  if (!match) return '';
  const [, y, mo, d, h, mi, s] = match;
  const wall = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  if (Number.isNaN(wall)) return '';
  let utc = wall - zoneOffsetMs(wall);
  const second = wall - zoneOffsetMs(utc);
  if (second !== utc) utc = second;
  const date = new Date(utc);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

/**
 * O zi calendaristică (`YYYY-MM-DD`, din `<input type="date">`) → începutul ei
 * (sau sfârșitul, cu `endOfDay`) în Chișinău, ca ISO UTC — pentru filtrele pe dată.
 */
export function dayBoundaryIso(day: string, endOfDay = false): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const start = fromDateTimeLocalValue(`${day}T00:00`);
  if (!endOfDay || start === '') return start;
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const nextDay = next.toISOString().slice(0, 10);
  const nextStart = fromDateTimeLocalValue(`${nextDay}T00:00`);
  return nextStart === '' ? '' : new Date(new Date(nextStart).getTime() - 1).toISOString();
}
