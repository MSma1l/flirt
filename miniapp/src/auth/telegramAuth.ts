/**
 * Autentificarea prin Telegram: trimite datele de inițializare BRUTE la backend.
 *
 * `initData` e un șir semnat de Telegram cu cheia botului. Doar serverul poate
 * verifica semnătura, deci îl trimitem ca atare, fără să-l despachetăm și fără
 * să ne uităm la `initDataUnsafe` pentru altceva decât afișare optimistă.
 */
import { AxiosError } from 'axios';

import { api } from '@/api/client';
import { getRawInitData, isInsideTelegram } from '@/telegram/bridge';

export interface TokenPair {
  access_token: string;
  refresh_token: string;
}

/**
 * De ce nu a mers autentificarea. Fiecare variantă are un mesaj propriu în
 * interfață — „a eșuat" generic nu spune utilizatorului ce să facă.
 */
export type AuthErrorKind =
  /** Pagina e deschisă în afara Telegram (browser obișnuit, dezvoltare). */
  | 'outside_telegram'
  /** `initData` e mai vechi decât fereastra acceptată de server. */
  | 'expired'
  /** Semnătura nu se verifică: date fabricate sau alt bot. */
  | 'invalid'
  /** Cererea nu a ajuns la server. */
  | 'network'
  /** Serverul a răspuns cu eroare (5xx) sau ceva neașteptat. */
  | 'server';

export class TelegramAuthError extends Error {
  constructor(readonly kind: AuthErrorKind, message?: string) {
    super(message ?? kind);
    this.name = 'TelegramAuthError';
  }
}

/** Textul de eroare trimis de backend, dacă există. */
function serverDetail(error: AxiosError): string {
  const data = error.response?.data as { detail?: unknown } | undefined;
  return typeof data?.detail === 'string' ? data.detail : '';
}

/**
 * Traduce o eroare axios într-un motiv pe care interfața îl poate explica.
 *
 * 401 poate însemna două lucruri foarte diferite: date EXPIRATE (utilizatorul a
 * lăsat Mini App-ul deschis o zi — se rezolvă reredeschizând) sau date INVALIDE
 * (semnătură greșită — nu se rezolvă prin reîncercare). Le separăm după textul
 * backendului, iar când acesta nu e explicit presupunem „expirat", varianta cu
 * soluție pentru utilizator.
 */
export function classifyAuthError(error: unknown): AuthErrorKind {
  const axiosError = error as AxiosError;
  if (!axiosError?.isAxiosError) return 'server';
  if (!axiosError.response) return 'network';

  const status = axiosError.response.status;
  if (status === 401 || status === 403 || status === 400 || status === 422) {
    const detail = serverDetail(axiosError).toLowerCase();
    // Mesajele backendului: „Telegram init data expired",
    // „Invalid Telegram init data signature", „Malformed Telegram init data",
    // „Telegram init data already used" (replay).
    if (detail.includes('expir')) return 'expired';
    if (
      detail.includes('invalid') ||
      detail.includes('malformed') ||
      detail.includes('signature') ||
      detail.includes('hash')
    ) {
      return 'invalid';
    }
    // Restul (inclusiv replay-ul) au aceeași soluție ca expirarea: închizi și
    // redeschizi Mini App-ul, iar Telegram dă un `initData` proaspăt.
    return 'expired';
  }
  return 'server';
}

/**
 * Schimbă `initData` pe o pereche de tokenuri.
 * Aruncă `TelegramAuthError` cu motivul potrivit; nu întoarce niciodată `null`
 * în tăcere, ca apelantul să fie obligat să trateze cazul.
 */
export async function authenticateWithTelegram(): Promise<TokenPair> {
  if (!isInsideTelegram()) {
    throw new TelegramAuthError('outside_telegram');
  }

  const initData = getRawInitData();
  if (!initData) {
    // SDK-ul e prezent, dar clientul nu a dat date: aplicația a fost deschisă
    // dintr-un context fără autentificare (ex. link direct într-un browser
    // care are extensia Telegram). Tratăm la fel ca „în afara Telegram".
    throw new TelegramAuthError('outside_telegram');
  }

  try {
    const { data } = await api.post<TokenPair>('/auth/telegram', { init_data: initData });
    if (!data?.access_token || !data?.refresh_token) {
      throw new TelegramAuthError('server', 'Răspuns fără tokenuri.');
    }
    return data;
  } catch (error) {
    if (error instanceof TelegramAuthError) throw error;
    throw new TelegramAuthError(classifyAuthError(error));
  }
}
