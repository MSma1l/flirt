/**
 * Acces la API pentru Flirt Passport (TZ secț. 8) în Mini App.
 *
 * Ca și `features/social/socialApi.ts`, fișierul doar RE-EXPORTĂ funcțiile pure
 * din aplicația Expo: ele nu ating React Native, iar `@/services/api` din ele e
 * mapat pe clientul axios al Mini App-ului. Ecranul importă rețeaua DE AICI, ca
 * testele să aibă un singur modul de mockat, chiar dacă datele vin din două
 * module diferite pe mobil (evenimente + abonamente).
 *
 * Rutele backend acoperite:
 *   GET /events/passport      (`backend/app/api/v1/events.py`) → ștampilele
 *   GET /subscriptions/me     (`backend/app/api/v1/subscriptions.py`) → abonamentul
 *   GET /events/passport/qr   → QR-ul personal de intrare + codul de plată
 */
import { api } from '@/api/client';

export { fetchPassport } from '@mobile/features/events/eventsApi';

export type { PassportStamp } from '@mobile/features/events/types';

export { fetchMySubscription } from '@mobile/features/subscription/subscriptionApi';

export type { Subscription } from '@mobile/features/subscription/types';

/** `GET /events/passport/qr` — permisul de intrare: QR-ul personal + codul de plată. */
export interface PassportQr {
  /** Conținutul QR-ului (`FLIRTP-<32 hex>`), scanat de staff la intrare. */
  qrPayload: string;
  /** Codul de plată (6 cifre); `null` dacă serverul nu l-a trimis. */
  paymentCode: string | null;
}

export async function fetchPassportQr(): Promise<PassportQr> {
  const { data } = await api.get<{ qr_payload?: unknown; payment_code?: unknown }>('/events/passport/qr');
  const qrPayload = typeof data?.qr_payload === 'string' ? data.qr_payload : '';
  if (!qrPayload) throw new Error('passport_qr_missing');
  const paymentCode = typeof data?.payment_code === 'string' && data.payment_code !== '' ? data.payment_code : null;
  return { qrPayload, paymentCode };
}
