/** Traducerea erorilor în mesaje utile pentru admin (niciodată „eroare necunoscută"). */
import { ApiError } from '../api/client';
import { currentLanguage, defineMessages } from '../i18n/LanguageContext';

const messages = defineMessages({
  ro: {
    offline: 'Serverul nu răspunde. Verifică conexiunea.',
    expired: 'Sesiune expirată. Autentifică-te din nou.',
    forbidden: 'Nu ai drepturi de administrator pentru această acțiune.',
    notFound: (detail: string) =>
      `Ruta nu există pe backend (404): ${detail}. Verifică versiunea API-ului.`,
    tooMany: 'Prea multe cereri. Încearcă din nou în scurt timp.',
    generic: 'Eroare la comunicarea cu serverul.',
  },
  ru: {
    offline: 'Сервер не отвечает. Проверьте подключение.',
    expired: 'Сессия истекла. Войдите снова.',
    forbidden: 'У вас нет прав администратора для этого действия.',
    notFound: (detail: string) =>
      `Маршрут не существует на сервере (404): ${detail}. Проверьте версию API.`,
    tooMany: 'Слишком много запросов. Попробуйте чуть позже.',
    generic: 'Ошибка связи с сервером.',
  },
});

export function errorMessage(error: unknown): string {
  const m = messages[currentLanguage()];
  if (error instanceof ApiError) {
    if (error.status === 0) return m.offline;
    if (error.status === 401) return m.expired;
    if (error.status === 403) return m.forbidden;
    if (error.status === 404) return m.notFound(error.detail);
    if (error.status === 429) return m.tooMany;
    return error.detail;
  }
  if (error instanceof Error && error.message) return error.message;
  return m.generic;
}
