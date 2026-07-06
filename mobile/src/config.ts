/** Config runtime — citit din app.json → extra (NIMIC hardcodat în ecrane). */
import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string };

export const config = {
  apiUrl: extra.apiUrl ?? 'http://localhost:8000/api/v1',
};
