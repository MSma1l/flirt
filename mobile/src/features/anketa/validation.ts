/** Funcții pure de validare pentru wizardul de anketă. Mesaje în română. */
import { AnketaDraft } from './types';

export const MIN_AGE = 16;
export const MIN_HEIGHT_CM = 100;
export const MAX_HEIGHT_CM = 250;
export const MAX_ABOUT_LENGTH = 500;

/** Calculează vârsta în ani împliniți la data `now`, pe baza datei de naștere. */
export function computeAge(birthDate: Date, now: Date = new Date()): number {
  let age = now.getFullYear() - birthDate.getFullYear();
  const monthDiff = now.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age;
}

/** Numele trebuie să fie ne-gol. */
export function validateName(value?: string): string | null {
  if (!value || !value.trim()) return 'Introdu numele tău.';
  return null;
}

/** Data nașterii trebuie să fie validă, în trecut, iar vârsta ≥ 16 ani. */
export function validateBirthDate(value?: string): string | null {
  if (!value || !value.trim()) return 'Introdu data nașterii.';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data nașterii nu este validă.';
  const now = new Date();
  if (date.getTime() > now.getTime()) return 'Data nașterii nu poate fi în viitor.';
  if (computeAge(date, now) < MIN_AGE) {
    return `Trebuie să ai cel puțin ${MIN_AGE} ani.`;
  }
  return null;
}

/** Genul trebuie ales. */
export function validateGender(value?: string): string | null {
  if (!value) return 'Alege genul.';
  return null;
}

/** Înălțimea (cm) trebuie să fie un număr rezonabil (100–250). */
export function validateHeight(value?: number): string | null {
  if (value == null || Number.isNaN(value)) return 'Introdu înălțimea în cm.';
  if (value < MIN_HEIGHT_CM || value > MAX_HEIGHT_CM) {
    return `Înălțimea trebuie să fie între ${MIN_HEIGHT_CM} și ${MAX_HEIGHT_CM} cm.`;
  }
  return null;
}

/** Orașul trebuie să fie ne-gol. */
export function validateCity(value?: string): string | null {
  if (!value || !value.trim()) return 'Introdu orașul.';
  return null;
}

/** Cel puțin o limbă de comunicare. */
export function validateLanguages(value?: string[]): string | null {
  if (!value || value.length === 0) return 'Alege cel puțin o limbă.';
  return null;
}

/** Câmpul „despre" este opțional, dar limitat la 500 de caractere. */
export function validateAbout(value?: string): string | null {
  if (value && value.length > MAX_ABOUT_LENGTH) {
    return `Textul depășește ${MAX_ABOUT_LENGTH} de caractere.`;
  }
  return null;
}

/** Cel puțin un interes. */
export function validateInterests(value?: string[]): string | null {
  if (!value || value.length === 0) return 'Alege cel puțin un interes.';
  return null;
}

/** Un mapping câmp → mesaj de eroare (câmpurile fără eroare lipsesc). */
export type FieldErrors = Partial<Record<keyof AnketaDraft, string>>;

/** Validează câmpurile unui pas anume; întoarce erorile găsite. */
export function validateStep(step: number, draft: Partial<AnketaDraft>): FieldErrors {
  const errors: FieldErrors = {};
  const add = (key: keyof AnketaDraft, err: string | null) => {
    if (err) errors[key] = err;
  };

  switch (step) {
    case 0:
      add('name', validateName(draft.name));
      add('birthDate', validateBirthDate(draft.birthDate));
      add('gender', validateGender(draft.gender));
      add('heightCm', validateHeight(draft.heightCm));
      break;
    case 1:
      add('city', validateCity(draft.city));
      add('languages', validateLanguages(draft.languages));
      break;
    case 2:
      add('about', validateAbout(draft.about));
      break;
    case 3:
      add('interests', validateInterests(draft.interests));
      break;
  }
  return errors;
}

/** True dacă obiectul de erori nu conține nicio eroare. */
export function isValid(errors: FieldErrors): boolean {
  return Object.keys(errors).length === 0;
}
