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
 *   * ticket_tiers: max 4 tipuri; nume `safe_str(60)` unic (fără diferență de
 *     majuscule), preț 0..1 000 000, plafon opțional întreg ≥ 1 (nu sub `sold`),
 *     descriere `optional_safe_str(200)` (`AdminTicketTierIn`);
 *   * ticket_sales_end_at: opțional, cel mult `starts_at + 12h`
 *     (`TICKET_SALES_END_MAX_AFTER_START` din `backend/app/models/event.py`);
 *   * ticket_capacity: opțional, ÎNTREG ≥ 1 (gol = nelimitat); sub `tickets_sold`
 *     backendul răspunde 409 `capacity_below_sold`;
 *   * cover_url: max 500 — backendul NU verifică forma (e `str`, nu `HttpUrl`),
 *     deci verificarea că e o adresă http(s) e responsabilitatea panoului.
 */
import { MAX_TICKET_TIERS, type AdminEvent, type EventInput } from '../api/types';
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
  tierName: 60,
  tierDescription: 200,
} as const;

/** Plafonul prețului unui bilet (`TICKET_PRICE_MAX` din backend). */
export const TICKET_PRICE_MAX = 1_000_000;

/** Numele tipului creat implicit din prețul unic (`DEFAULT_TICKET_TIER_NAME`). */
export const DEFAULT_TIER_NAME = 'Standard';

/** Un rând de tip de bilet în formular (valorile brute din inputuri). */
export interface TierFormRow {
  /** Cheie locală stabilă pentru React (rândurile se reordonează). */
  key: string;
  /** Id-ul din backend; `null` = tip nou. */
  id: string | null;
  name: string;
  price: string;
  capacity: string; // gol = fără plafon propriu
  description: string;
  /** Bilete deja vândute din tip (read-only; 0 pentru unul nou). */
  sold: number;
}

let tierKeySeq = 0;
function nextTierKey(): string {
  tierKeySeq += 1;
  return `tier-${tierKeySeq}`;
}

export function newTierRow(partial: Partial<TierFormRow> = {}): TierFormRow {
  return {
    key: nextTierKey(),
    id: null,
    name: '',
    price: '',
    capacity: '',
    description: '',
    sold: 0,
    ...partial,
  };
}

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
  /**
   * DERIVAT din `ticket_tiers` (prețul minim, „de la") — nu are input propriu.
   * Îl citește previzualizarea; se recalculează prin `withTiers`.
   */
  ticket_price: string;
  ticket_currency: string;
  ticket_sales_end_at: string; // `datetime-local`; gol = la începutul evenimentului
  ticket_capacity: string; // gol = nelimitat (capacitatea TOTALĂ)
  /** Tipurile de bilet, în ordinea de afișare (max 4). Gol = fără bilet online. */
  ticket_tiers: TierFormRow[];
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
  ticket_capacity: '',
  ticket_tiers: [],
};

/** Prețul minim al rândurilor valide, ca text (`''` dacă nu există niciunul). */
function minTierPrice(rows: TierFormRow[]): string {
  const prices = rows
    .map((row) => parseNumber(row.price))
    .filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0);
  return prices.length === 0 ? '' : String(Math.min(...prices));
}

/** Formularul cu tipurile noi + `ticket_price` (derivat) recalculat. */
export function withTiers(form: FormState, rows: TierFormRow[]): FormState {
  return { ...form, ticket_tiers: rows, ticket_price: minTierPrice(rows) };
}

/** Mută rândul `index` cu `delta` poziții (−1 sus, +1 jos); în afara listei = neschimbat. */
export function moveTier(rows: TierFormRow[], index: number, delta: number): TierFormRow[] {
  const target = index + delta;
  if (index < 0 || index >= rows.length || target < 0 || target >= rows.length) return rows;
  const next = [...rows];
  const [row] = next.splice(index, 1);
  if (row) next.splice(target, 0, row);
  return next;
}

export function canAddTier(rows: TierFormRow[]): boolean {
  return rows.length < MAX_TICKET_TIERS;
}

function tiersFromEvent(event: AdminEvent): TierFormRow[] {
  if (event.ticket_tiers && event.ticket_tiers.length > 0) {
    return [...event.ticket_tiers]
      .sort((a, b) => a.position - b.position)
      .map((tier) =>
        newTierRow({
          id: tier.id,
          name: tier.name,
          price: String(tier.price),
          capacity: tier.capacity === null ? '' : String(tier.capacity),
          description: tier.description ?? '',
          sold: tier.sold ?? 0,
        }),
      );
  }
  // Eveniment vechi (doar prețul unic): un rând nou cu acel preț.
  if (event.ticket_price !== null) {
    return [newTierRow({ name: DEFAULT_TIER_NAME, price: String(event.ticket_price) })];
  }
  return [];
}

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
    ticket_tiers: tiersFromEvent(event),
    ticket_currency: event.ticket_currency ?? DEFAULT_CURRENCY,
    ticket_sales_end_at: event.ticket_sales_end_at
      ? toDateTimeLocalValue(event.ticket_sales_end_at)
      : '',
    ticket_capacity:
      event.ticket_capacity === null || event.ticket_capacity === undefined
        ? ''
        : String(event.ticket_capacity),
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

/** Erorile unui rând de tip de bilet, pe câmp. */
export type TierRowErrors = Partial<Record<'name' | 'price' | 'capacity' | 'description', string>>;

/**
 * Erorile fiecărui rând de tip (același index ca `form.ticket_tiers`). Oglinda
 * lui `AdminTicketTierIn` + verificarea de nume unice din backend.
 */
export function validateTiers(rows: TierFormRow[], language: Language = 'ro'): TierRowErrors[] {
  const m = eventsMessages[language].validation;
  const names = eventsMessages[language].fieldNames;
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const errors: TierRowErrors = {};
    const name = row.name.trim();
    if (name === '') errors.name = m.tierNameRequired;
    else {
      const problem = textProblem(row.name, EVENT_LIMITS.tierName, names.tierName, language);
      if (problem) errors.name = problem;
      const folded = name.toLocaleLowerCase();
      if (seen.has(folded)) errors.name = m.tierNameDuplicate;
      seen.set(folded, (seen.get(folded) ?? 0) + 1);
    }

    const price = parseNumber(row.price);
    if (price === null) errors.price = m.tierPriceRequired;
    else if (!Number.isFinite(price) || price < 0) errors.price = m.priceNegative;
    else if (price > TICKET_PRICE_MAX) errors.price = m.priceTooHigh;

    const capacity = parseNumber(row.capacity);
    if (capacity !== null) {
      if (!Number.isFinite(capacity) || !Number.isInteger(capacity) || capacity < 1) {
        errors.capacity = m.capacityInteger;
      } else if (capacity < row.sold) {
        errors.capacity = m.capacityBelowSold(row.sold);
      }
    }

    const descProblem = textProblem(
      row.description,
      EVENT_LIMITS.tierDescription,
      names.tierDescription,
      language,
    );
    if (descProblem) errors.description = descProblem;
    return errors;
  });
}

/**
 * Erorile BLOCANTE: exact ce ar întoarce backendul cu 422, prins înainte de
 * cerere. Cheia e numele câmpului, ca UI-ul să pună mesajul sub input.
 */
export function validate(
  form: FormState,
  language: Language = 'ro',
  ticketsSold = 0,
): FormErrors {
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

  // --- bilet: tipurile (erorile pe rând le dă `validateTiers`) ---
  if (form.ticket_tiers.length > MAX_TICKET_TIERS) {
    errors.ticket_tiers = m.tiersMax(MAX_TICKET_TIERS);
  } else if (
    validateTiers(form.ticket_tiers, language).some((row) => Object.keys(row).length > 0)
  ) {
    errors.ticket_tiers = m.tiersInvalid;
  }
  if (form.ticket_tiers.length > 0) {
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

  // --- capacitatea de bilete (opțional; întreg ≥ 1, nu sub cele vândute) ---
  const capacity = parseNumber(form.ticket_capacity);
  if (capacity !== null) {
    if (!Number.isFinite(capacity) || !Number.isInteger(capacity) || capacity < 1) {
      errors.ticket_capacity = m.capacityInteger;
    } else if (capacity < ticketsSold) {
      errors.ticket_capacity = m.capacityBelowSold(ticketsSold);
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

  const tiers = form.ticket_tiers.map((row) => ({
    id: row.id,
    name: row.name.trim(),
    price: num(row.price) ?? 0,
    capacity: num(row.capacity),
    description: orNull(row.description),
  }));
  const hasTickets = tiers.length > 0;
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
    // Tipurile sunt sursa prețului; backendul derivă `ticket_price` (minimul).
    ticket_tiers: tiers,
    // Moneda are sens doar când există bilete; fără tipuri → null (bilet indisponibil).
    ticket_currency: hasTickets ? orNull(form.ticket_currency) : null,
    // Gol → `null`: backendul închide vânzarea la începutul evenimentului.
    ticket_sales_end_at:
      form.ticket_sales_end_at.trim() === ''
        ? null
        : fromDateTimeLocalValue(form.ticket_sales_end_at) || null,
    // Gol → `null` = nelimitat.
    ticket_capacity: num(form.ticket_capacity),
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
