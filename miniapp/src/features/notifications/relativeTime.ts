/**
 * Timp relativ („acum 5 min", „ieri", „3 дня назад") prin `Intl`, fără catalog
 * propriu: browserul știe deja regulile de plural și formulările fiecărei limbi.
 * Peste o săptămână arătăm data („12 oct."), care se citește mai ușor decât
 * „acum 23 de zile".
 */
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export function formatRelative(iso: string, language: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const seconds = Math.round((then.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);

  if (abs >= WEEK) {
    return then.toLocaleDateString(language, { day: 'numeric', month: 'short' });
  }

  const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto', style: 'short' });
  if (abs < MINUTE) return rtf.format(0, 'second');
  if (abs < HOUR) return rtf.format(Math.round(seconds / MINUTE), 'minute');
  if (abs < DAY) return rtf.format(Math.round(seconds / HOUR), 'hour');
  return rtf.format(Math.round(seconds / DAY), 'day');
}
