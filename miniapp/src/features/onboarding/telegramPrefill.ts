/**
 * Ce putem precompleta din datele Telegramului.
 *
 * ATENȚIE: sursa e `initDataUnsafe`, care NU e dovadă de identitate (vezi
 * `telegram/bridge.ts`). E în regulă aici: nu decidem nimic pe baza lui, doar
 * scutim utilizatorul de tastat un nume pe care oricum îl poate schimba.
 * Identitatea reală a fost deja verificată pe server la `POST /auth/telegram`.
 */
import type { AnketaDraft } from '@mobile/features/anketa/types';
import { normalizeLanguage, type Language } from '@mobile/i18n/config';
import { LIMITS } from '@mobile/utils/validation';

import { getUnsafeUser } from '@/telegram/bridge';

export interface TelegramIdentity {
  firstName: string;
  lastName: string;
  /** Numele afișabil, tăiat la limita backendului. */
  fullName: string;
  /** Poza de profil Telegram — poate lipsi (setare de confidențialitate). */
  photoUrl: string | null;
  username: string | null;
  /** Limba clientului, adusă la una dintre limbile noastre. */
  language: Language | null;
}

/** Datele Telegramului, sau `null` în afara clientului (dezvoltare în browser). */
export function telegramIdentity(): TelegramIdentity | null {
  const user = getUnsafeUser();
  if (!user) return null;

  const firstName = (user.first_name ?? '').trim();
  const lastName = (user.last_name ?? '').trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ').slice(0, LIMITS.name);

  return {
    firstName,
    lastName,
    fullName,
    photoUrl: user.photo_url ?? null,
    username: user.username ?? null,
    language: normalizeLanguage(user.language_code),
  };
}

/**
 * Valorile de pornire ale formularului.
 *
 * Precompletăm DOAR ce știm sigur: numele și limba de comunicare. Data nașterii,
 * genul, înălțimea și orașul nu se pot ghici — Telegram nu le are, iar o valoare
 * inventată ar intra în profil neobservată.
 */
export function prefillFromTelegram(
  identity: TelegramIdentity | null,
  activeLanguage: Language,
): Partial<AnketaDraft> {
  const language = identity?.language ?? activeLanguage;
  return {
    name: identity?.fullName ?? '',
    languages: [language],
  };
}
