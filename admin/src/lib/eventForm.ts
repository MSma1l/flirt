/**
 * Regulile de eveniment ale panoului, ca funcții PURE (fără React).
 *
 * DE CE STAU SEPARAT DE PAGINĂ: validarea de aici trebuie să fie OGLINDA EXACTĂ
 * a schemelor din `backend/app/schemas/admin.py` (`AdminEventIn`) și a
 * validatorilor din `backend/app/core/validators.py`. Dacă regula e îngropată
 * într-un JSX de 500 de linii, nimeni nu o compară cu backendul și panoul începe
 * să trimită payload-uri care se întorc cu 422 fără explicații utile. Aici e
 * scrisă o dată, testată direct, și citită alături de sursa ei.
 *
 * Ce copiem din backend, câmp cu câmp:
 *   * `safe_str(n)`          → trim, NON-GOL, max n, fără HTML, fără control chars;
 *   * `optional_safe_str(n)` → la fel, dar gol după trim ⇒ se trimite `null`
 *                              (NU string gol: backendul l-ar respinge cu 422);
 *   * lat ∈ [-90, 90], lng ∈ [-180, 180] (`Field(ge=…, le=…)`);
 *   * promo_discount_percent ∈ [0, 100], ÎNTREG (`int | None`);
 *   * ticket_price ≥ 0;
 *   * ticket_sales_end_at: opțional, cel mult `starts_at + 12h`
 *     (`TICKET_SALES_END_MAX_AFTER_START` din `backend/app/models/event.py`);
 *   * cover_url: max 500 — backendul NU verifică forma (e `str`, nu `HttpUrl`),
 *     deci verificarea că e o adresă http(s) e responsabilitatea panoului.
 */
import type { AdminEvent, EventInput } from '../api/types';
import type { Language } from '../i18n/LanguageContext';
import { eventsMessages } from '../i18n/messages/events';
import { fromDateTimeLocalValue, toDateTimeLocalValue } from './format';

/** Lungimile maxime, aliniate 1:1 cu constantele `EVENT_*_MAX_LENGTH` din backend. */
export const EVENT_LIMITS = {
  title: 200,
  city: 120,
  venue: 200,
  description: 2000,
  coverUrl: 500,
  promoCode: 32,
  promoDescription: 500,
  ticketCurrency: 8,
} as const;

/** Cât de târziu după start se poate închide vânzarea online (oglinda backendului). */
export const TICKET_SALES_END_MAX_AFTER_START_MS = 12 * 60 * 60 * 1000;

/** Moneda implicită a biletului (`Event.ticket_currency` server_default). */
export const DEFAULT_CURRENCY = 'lei';

export interface FormState {
  title: string;
  description: string;
  starts_at: string; // valoare `datetime-local` (ora LOCALĂ a adminului)
  city: string;
  venue: string;
  kind: string;
  cover_url: string;
  lat: string;
  lng: string;
  promo_discount_percent: string;
  promo_code: string;
  promo_description: string;
  ticket_price: string;
  ticket_currency: string;
  ticket_sales_end_at: string; // `datetime-local`; gol = la începutul evenimentului
}

export const EMPTY_FORM: FormState = {
  title: '',
  description: '',
  starts_at: '',
  city: '',
  venue: '',
  kind: 'flirt_party',
  cover_url: '',
  lat: '',
  lng: '',
  promo_discount_percent: '',
  promo_code: '',
  promo_description: '',
  ticket_price: '',
  ticket_currency: DEFAULT_CURRENCY,
  ticket_sales_end_at: '',
};

export function toForm(event: AdminEvent): FormState {
  return {
    title: event.title,
    description: event.description ?? '',
    starts_at: toDateTimeLocalValue(event.starts_at),
    city: event.city,
    venue: event.venue ?? '',
    kind: event.kind,
    cover_url: event.cover_url ?? '',
    lat: event.lat === null ? '' : String(event.lat),
    lng: event.lng === null ? '' : String(event.lng),
    promo_discount_percent:
      event.promo_discount_percent === null ? '' : String(event.promo_discount_percent),
    promo_code: event.promo_code ?? '',
    promo_description: event.promo_description ?? '',
    ticket_price: event.ticket_price === null ? '' : String(event.ticket_price),
    ticket_currency: event.ticket_currency ?? DEFAULT_CURRENCY,
    ticket_sales_end_at: event.ticket_sales_end_at
      ? toDateTimeLocalValue(event.ticket_sales_end_at)
      : '',
  };
}

/* --------------------------- validare de câmp --------------------------- */

/** `_HTML_RE` din `backend/app/core/validators.py`. */
const HTML_RE = /<[^>]*>/;
/** `_CONTROL_RE` din backend (control chars, mai puțin \n și \t). */
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/**
 * Textul liber acceptat de `safe_str`/`optional_safe_str`.
 *
 * EXPORTAT pentru că e oglinda unică a validatorilor de text din backend: și
 * formularele de fidelitate (`lib/loyaltyForm.ts`) trec prin aceeași regulă. O a
 * doua copie ar fi început să divergă de la prima modificare a backendului.
 */
export function textProblem(
  value: string,
  max: number,
  label: string,
  language: Language = 'ro',
): string | null {
  const t = eventsMessages[language].text;
  const trimmed = value.trim();
  if (trimmed.length > max) return t.tooLong(label, max);
  if (HTML_RE.test(trimmed)) return t.html(label);
  if (CONTROL_RE.test(trimmed)) return t.control(label);
  return null;
}

/** Coordonate utilizabile — PORT al lui `hasValidCoords` din miniapp/EventMap. */
export function hasValidCoords(lat: number | null, lng: number | null): boolean {
  return (
    lat !== null &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    lng !== null &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180
  );
}

/** Numărul dintr-un câmp text: gol → `null`, text invalid → `NaN`. */
export function parseNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  return Number(trimmed.replace(',', '.'));
}

export type FormErrors = Partial<Record<keyof FormState, string>>;

/**
 * Erorile BLOCANTE: exact ce ar întoarce backendul cu 422, prins înainte de
 * cerere. Cheia e numele câmpului, ca UI-ul să pună mesajul sub input.
 */
export function validate(form: FormState, language: Language = 'ro'): FormErrors {
  const errors: FormErrors = {};
  const m = eventsMessages[language].validation;
  const names = eventsMessages[language].fieldNames;

  // --- obligatorii (safe_str) ---
  if (form.title.trim() === '') errors.title = m.titleRequired;
  else {
    const problem = textProblem(form.title, EVENT_LIMITS.title, names.title, language);
    if (problem) errors.title = problem;
  }

  if (form.city.trim() === '') errors.city = m.cityRequired;
  else {
    const problem = textProblem(form.city, EVENT_LIMITS.city, names.city, language);
    if (problem) errors.city = problem;
  }

  if (form.starts_at.trim() === '') {
    errors.starts_at = m.startsRequired;
  } else if (fromDateTimeLocalValue(form.starts_at) === '') {
    errors.starts_at = m.dateInvalid;
  }

  // --- opționale (optional_safe_str) ---
  const venueProblem = textProblem(form.venue, EVENT_LIMITS.venue, names.venue, language);
  if (venueProblem) errors.venue = venueProblem;

  const descProblem = textProblem(form.description, EVENT_LIMITS.description, names.description, language);
  if (descProblem) errors.description = descProblem;

  const codeProblem = textProblem(form.promo_code, EVENT_LIMITS.promoCode, names.promoCode, language);
  if (codeProblem) errors.promo_code = codeProblem;

  const promoDescProblem = textProblem(
    form.promo_description,
    EVENT_LIMITS.promoDescription,
    names.promoDescription,
    language,
  );
  if (promoDescProblem) errors.promo_description = promoDescProblem;

  // --- copertă: backendul acceptă orice șir ≤ 500; forma o apărăm noi ---
  const cover = form.cover_url.trim();
  if (cover !== '') {
    if (cover.length > EVENT_LIMITS.coverUrl) {
      errors.cover_url = m.coverTooLong(EVENT_LIMITS.coverUrl);
    } else if (!/^https?:\/\/\S+$/i.test(cover)) {
      errors.cover_url = m.coverScheme;
    }
  }

  // --- coordonate ---
  const lat = parseNumber(form.lat);
  const lng = parseNumber(form.lng);
  if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) {
    errors.lat = m.latRange;
  }
  if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) {
    errors.lng = m.lngRange;
  }
  // O singură coordonată nu înseamnă nimic pe hartă: backendul ar accepta-o,
  // aplicația ar cădea pe caseta cu orașul, iar adminul ar crede că a pus pin-ul.
  if (lat !== null && lng === null && errors.lng === undefined) {
    errors.lng = m.lngMissing;
  }
  if (lng !== null && lat === null && errors.lat === undefined) {
    errors.lat = m.latMissing;
  }

  // --- promo ---
  const percent = parseNumber(form.promo_discount_percent);
  if (percent !== null) {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      errors.promo_discount_percent = m.percentRange;
    } else if (!Number.isInteger(percent)) {
      errors.promo_discount_percent = m.percentInteger;
    }
  }

  // --- bilet ---
  const price = parseNumber(form.ticket_price);
  if (price !== null && (!Number.isFinite(price) || price < 0)) {
    errors.ticket_price = m.priceNegative;
  }
  if (price !== null && Number.isFinite(price)) {
    if (form.ticket_currency.trim() === '') {
      errors.ticket_currency = m.currencyRequired;
    } else {
      const currencyProblem = textProblem(
        form.ticket_currency,
        EVENT_LIMITS.ticketCurrency,
        names.currency,
        language,
      );
      if (currencyProblem) errors.ticket_currency = currencyProblem;
    }
  }

  // --- închiderea vânzării online (opțional; cel mult start + 12h) ---
  if (form.ticket_sales_end_at.trim() !== '') {
    const salesEnd = fromDateTimeLocalValue(form.ticket_sales_end_at);
    const starts = fromDateTimeLocalValue(form.starts_at);
    if (salesEnd === '') {
      errors.ticket_sales_end_at = m.dateInvalid;
    } else if (
      starts !== '' &&
      new Date(salesEnd).getTime() >
        new Date(starts).getTime() + TICKET_SALES_END_MAX_AFTER_START_MS
    ) {
      errors.ticket_sales_end_at = m.salesEndTooLate;
    }
  }

  return errors;
}

/**
 * Avertismentele NEBLOCANTE: lucruri pe care backendul le acceptă, dar care fac
 * evenimentul să arate prost (sau să lipsească) în aplicație. Se arată în
 * formular, nu se descoperă peste două săptămâni, când sună organizatorul.
 */
export function warnings(
  form: FormState,
  now: number = Date.now(),
  language: Language = 'ro',
): string[] {
  const list: string[] = [];
  const w = eventsMessages[language].warnings;
  const lat = parseNumber(form.lat);
  const lng = parseNumber(form.lng);

  if (!hasValidCoords(lat, lng)) {
    list.push(w.noCoords);
  }
  if (form.cover_url.trim() === '') {
    list.push(w.noCover);
  }
  if (form.venue.trim() === '') {
    list.push(w.noVenue);
  }
  if (form.description.trim() === '') {
    list.push(w.noDescription);
  }
  // Regula exactă din `miniapp/src/features/events/EventScreen.tsx`:
  // `hasPromo = promoDiscountPercent != null && promoCode != null`.
  const percent = parseNumber(form.promo_discount_percent);
  if (percent !== null && form.promo_code.trim() === '') {
    list.push(w.percentWithoutCode);
  }
  if (form.promo_code.trim() !== '' && percent === null) {
    list.push(w.codeWithoutPercent);
  }
  const starts = fromDateTimeLocalValue(form.starts_at);
  if (starts !== '' && new Date(starts).getTime() < now) {
    list.push(w.past);
  }
  return list;
}

/** Formularul → payload-ul exact pe care îl cere `AdminEventIn`. */
export function toPayload(form: FormState): EventInput {
  const orNull = (value: string): string | null => {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  };
  const num = (raw: string): number | null => {
    const value = parseNumber(raw);
    return value === null || !Number.isFinite(value) ? null : value;
  };

  const price = num(form.ticket_price);
  return {
    title: form.title.trim(),
    description: orNull(form.description),
    starts_at: fromDateTimeLocalValue(form.starts_at),
    city: form.city.trim(),
    venue: orNull(form.venue),
    kind: form.kind,
    cover_url: orNull(form.cover_url),
    lat: num(form.lat),
    lng: num(form.lng),
    promo_discount_percent: num(form.promo_discount_percent),
    promo_code: orNull(form.promo_code),
    promo_description: orNull(form.promo_description),
    ticket_price: price,
    // Moneda are sens doar când există preț; fără preț → null (bilet indisponibil).
    ticket_currency: price === null ? null : orNull(form.ticket_currency),
    // Gol → `null`: backendul închide vânzarea la începutul evenimentului.
    ticket_sales_end_at:
      form.ticket_sales_end_at.trim() === ''
        ? null
        : fromDateTimeLocalValue(form.ticket_sales_end_at) || null,
  };
}

/* ------------------------------ lista ----------------------------------- */

export type EventTimeFilter = 'all' | 'upcoming' | 'past';
export type EventSort = 'soonest' | 'latest';

export function isUpcoming(event: AdminEvent, now: number = Date.now()): boolean {
  const time = new Date(event.starts_at).getTime();
  return Number.isNaN(time) ? true : time >= now;
}

/** Fără diacritice și fără majuscule: „Bucuresti" trebuie să găsească „București". */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function matchesSearch(event: AdminEvent, search: string): boolean {
  const needle = fold(search.trim());
  if (needle === '') return true;
  const haystack = fold(
    [event.title, event.city, event.venue ?? '', event.promo_code ?? ''].join(' '),
  );
  return haystack.includes(needle);
}

export function selectEvents(
  events: AdminEvent[],
  options: { search?: string; filter?: EventTimeFilter; sort?: EventSort; now?: number },
): AdminEvent[] {
  const { search = '', filter = 'all', sort = 'soonest', now = Date.now() } = options;
  const filtered = events.filter((event) => {
    if (!matchesSearch(event, search)) return false;
    if (filter === 'upcoming') return isUpcoming(event, now);
    if (filter === 'past') return !isUpcoming(event, now);
    return true;
  });
  return [...filtered].sort((a, b) => {
    const left = new Date(a.starts_at).getTime();
    const right = new Date(b.starts_at).getTime();
    return sort === 'soonest' ? left - right : right - left;
  });
}
