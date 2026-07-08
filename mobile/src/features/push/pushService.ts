/**
 * Înregistrarea dispozitivului pentru notificări push (TZ secț. notificări).
 * Robust: dacă obținerea token-ului sau cererea eșuează, NU aruncă — push-ul
 * este opțional și nu trebuie să blocheze pornirea aplicației.
 */
import { Platform } from 'react-native';

import { api } from '@/services/api';

/**
 * Obține token-ul de push pentru dispozitivul curent.
 *
 * PROD: expo-notifications getExpoPushTokenAsync (după cererea permisiunilor).
 * În dev întoarcem un placeholder determinist, ca fluxul să fie testabil fără
 * dependențe native.
 */
async function getPushToken(): Promise<string> {
  return `expo-dev-token-${Platform.OS}`;
}

/**
 * Înregistrează dispozitivul la backend pentru notificări push.
 * Prinde orice eroare (rețea, permisiuni, token indisponibil) și o ignoră.
 */
export async function registerDevice(): Promise<void> {
  try {
    const token = await getPushToken();
    await api.post('/push/register', { token, platform: Platform.OS });
  } catch {
    // Push-ul e opțional: un eșec aici nu trebuie să afecteze aplicația.
  }
}
