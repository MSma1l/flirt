/** Traducerea erorilor în mesaje utile pentru admin (niciodată „eroare necunoscută"). */
import { ApiError } from '../api/client';

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return 'Serverul nu răspunde. Verifică conexiunea.';
    if (error.status === 401) return 'Sesiune expirată. Autentifică-te din nou.';
    if (error.status === 403) return 'Nu ai drepturi de administrator pentru această acțiune.';
    if (error.status === 404) {
      return `Ruta nu există pe backend (404): ${error.detail}. Verifică versiunea API-ului.`;
    }
    if (error.status === 429) return 'Prea multe cereri. Încearcă din nou în scurt timp.';
    return error.detail;
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Eroare la comunicarea cu serverul.';
}
