/**
 * Validarea anketei pe client, simetrică cu backendul.
 *
 * REGULILE sunt REUTILIZATE din `mobile/src/utils/validation.ts` (fișier pur,
 * fără niciun import — intră în bundle-ul Vite ca atare): `computeAge`,
 * `MIN_AGE`, `MIN_HEIGHT_CM`, `MAX_HEIGHT_CM`, `LIMITS`, `hasHtml`. Sunt exact
 * aceleași praguri pe care le impune și serverul
 * (`settings.min_registration_age = 18`, `height_cm` 0<x<300 în schema Pydantic
 * strâns la 100–250 pe client, `about_max_length = 500`, `safe_str` anti-XSS).
 *
 * MESAJELE însă NU se reutilizează: modulul mobil întoarce propoziții gata
 * scrise, în română. Mini App-ul e în trei limbi, iar un utilizator rus care
 * greșește data nașterii nu are ce face cu un text românesc. De aceea folosim
 * PREDICATELE de acolo (modulul le expune explicit tocmai pentru asta) și
 * întoarcem CHEI de traducere.
 *
 * Ce NU validăm aici: `gender` și `interests` față de catalog — catalogul vine
 * de la `GET /profiles/reference`, iar interfața oferă doar valori din el.
 */
import type { AnketaDraft } from '@mobile/features/anketa/types';
import {
  computeAge,
  hasHtml,
  LIMITS,
  MAX_HEIGHT_CM,
  MIN_AGE,
  MIN_HEIGHT_CM,
} from '@mobile/utils/validation';

/** O eroare de câmp, gata de tradus: cheie din namespace-ul `miniapp` + parametri. */
export interface FieldError {
  key: string;
  params?: Record<string, string | number>;
}

/** Vârsta minimă de înregistrare — aceeași valoare ca `MIN_REGISTRATION_AGE`. */
export { MIN_AGE as MIN_REGISTRATION_AGE, MIN_HEIGHT_CM, MAX_HEIGHT_CM };

const E = 'onboarding.errors.';

/** Numele: ne-gol, ≤120 caractere, fără marcaje HTML (backendul are `safe_str`). */
export function validateName(value: string | undefined): FieldError | null {
  if (!value || !value.trim()) return { key: `${E}nameRequired` };
  if (hasHtml(value)) return { key: `${E}noHtml` };
  if (value.length > LIMITS.name) {
    return { key: `${E}tooLong`, params: { max: LIMITS.name } };
  }
  return null;
}

/**
 * Data nașterii (ISO `YYYY-MM-DD`): validă, în trecut, vârsta ≥ 18.
 *
 * Aplicația e 18+ ONLY. Calculul se face pe `computeAge` din modulul partajat,
 * care citește AMBELE date în UTC — dacă am amesteca getterele locale, într-un
 * fus negativ un minor ar trece poarta cu o zi înainte de ziua lui.
 */
export function validateBirthDate(
  value: string | undefined,
  now: Date = new Date(),
): FieldError | null {
  const v = (value ?? '').trim();
  if (!v) return { key: `${E}birthDateRequired` };
  const date = new Date(v);
  if (Number.isNaN(date.getTime())) return { key: `${E}birthDateInvalid` };
  if (date.getTime() > now.getTime()) return { key: `${E}birthDateFuture` };
  if (computeAge(date, now) < MIN_AGE) {
    return { key: `${E}tooYoung`, params: { min: MIN_AGE } };
  }
  return null;
}

/** Genul trebuie ales din catalogul de referință. */
export function validateGender(value: string | undefined): FieldError | null {
  return value ? null : { key: `${E}genderRequired` };
}

/** Înălțimea în cm: număr întreg rezonabil (100–250). */
export function validateHeight(value: number | undefined): FieldError | null {
  if (value == null || Number.isNaN(value)) return { key: `${E}heightRequired` };
  if (value < MIN_HEIGHT_CM || value > MAX_HEIGHT_CM) {
    return { key: `${E}heightRange`, params: { min: MIN_HEIGHT_CM, max: MAX_HEIGHT_CM } };
  }
  return null;
}

/** Orașul: ne-gol, ≤120 caractere, fără marcaje HTML. */
export function validateCity(value: string | undefined): FieldError | null {
  if (!value || !value.trim()) return { key: `${E}cityRequired` };
  if (hasHtml(value)) return { key: `${E}noHtml` };
  if (value.length > LIMITS.city) {
    return { key: `${E}tooLong`, params: { max: LIMITS.city } };
  }
  return null;
}

/** Cel puțin o limbă — backendul respinge lista goală cu 422. */
export function validateLanguages(value: string[] | undefined): FieldError | null {
  return value && value.length > 0 ? null : { key: `${E}languagesRequired` };
}

/** Cel puțin un interes valid — și asta e o regulă de business a backendului. */
export function validateInterests(value: string[] | undefined): FieldError | null {
  return value && value.length > 0 ? null : { key: `${E}interestsRequired` };
}

/** „Despre mine" e opțional, dar ≤500 caractere și fără marcaje HTML. */
export function validateAbout(value: string | undefined): FieldError | null {
  if (!value) return null;
  if (hasHtml(value)) return { key: `${E}noHtml` };
  if (value.length > LIMITS.about) {
    return { key: `${E}tooLong`, params: { max: LIMITS.about } };
  }
  return null;
}

/** Erorile unui draft: câmpurile valide lipsesc din obiect. */
export type DraftErrors = Partial<Record<keyof AnketaDraft, FieldError>>;

/**
 * Validează TOT draftul dintr-o dată.
 *
 * Un singur ecran, nu un wizard în cinci pași ca pe mobil: proprietarul a cerut
 * „se pun datele Telegramului și gata", iar cu cât sunt mai puține ecrane între
 * buton și feed, cu atât mai puține locuri unde utilizatorul se poate opri.
 */
export function validateDraft(
  draft: Partial<AnketaDraft>,
  now: Date = new Date(),
): DraftErrors {
  const errors: DraftErrors = {};
  const add = (field: keyof AnketaDraft, error: FieldError | null) => {
    if (error) errors[field] = error;
  };

  add('name', validateName(draft.name));
  add('birthDate', validateBirthDate(draft.birthDate, now));
  add('gender', validateGender(draft.gender));
  add('heightCm', validateHeight(draft.heightCm));
  add('city', validateCity(draft.city));
  add('languages', validateLanguages(draft.languages));
  add('interests', validateInterests(draft.interests));
  add('about', validateAbout(draft.about));

  return errors;
}

/** True dacă nu s-a găsit nicio eroare. */
export function isValid(errors: DraftErrors): boolean {
  return Object.keys(errors).length === 0;
}
