/**
 * Secțiunea „Notificări în Telegram" din ecranul de Setări: patru comutatoare
 * pentru mesajele pe care botul le trimite (mesaj nou, like, poveste, match).
 *
 * Component separat, ca la `AiSettingsSection`: rețeaua, stările și textele
 * stau în `features/notifications/`, iar ecranul de Setări are un import și o
 * linie de JSX.
 *
 * Comutatoarele sunt OPTIMISTE (se mută imediat, revin la eroare) și blocate
 * cât timp o salvare e în zbor — două cereri suprapuse s-ar putea întoarce în
 * ordine inversă și ar lăsa pe ecran altceva decât pe server.
 *
 * Server vechi, fără ruta (404) → secțiunea nu se randează deloc.
 */
import { useTranslation } from 'react-i18next';

import {
  isNotSupported,
  TELEGRAM_NOTIFICATION_KINDS,
  useTelegramNotifications,
  useUpdateTelegramNotifications,
} from './telegramNotificationsApi';
import { WriteAccessCard } from './WriteAccessCard';

import './notifications.css';

export function TelegramNotificationsSection() {
  const { t } = useTranslation('screens');
  const query = useTelegramNotifications();
  const update = useUpdateTelegramNotifications();

  if (query.isError && isNotSupported(query.error)) return null;

  return (
    <section className="settings-section" data-testid="telegram-notifications-section">
      <h2 className="settings-section__title">{t('telegramNotifications.title')}</h2>
      <p className="caption">{t('telegramNotifications.hint')}</p>

      {query.isPending ? (
        <div className="tn-inline" data-testid="telegram-notifications-loading">
          <span
            className="spinner spinner--sm"
            role="status"
            aria-label={t('telegramNotifications.loading')}
          />
          <span className="caption">{t('telegramNotifications.loading')}</span>
        </div>
      ) : query.isError || !query.data ? (
        <div className="tn-inline" data-testid="telegram-notifications-load-error">
          <p className="error-text">{t('telegramNotifications.loadError')}</p>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => void query.refetch()}
            data-testid="telegram-notifications-retry"
          >
            {t('telegramNotifications.retry')}
          </button>
        </div>
      ) : (
        <>
          {TELEGRAM_NOTIFICATION_KINDS.map((kind) => (
            <label key={kind} className="settings-toggle">
              <span className="body-text settings-toggle__label">
                {t(`telegramNotifications.kinds.${kind}`)}
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={query.data[kind]}
                disabled={update.isPending}
                onChange={(e) => update.mutate({ [kind]: e.target.checked })}
                data-testid={`tg-notif-${kind}`}
              />
            </label>
          ))}

          {update.isError ? (
            <p className="error-text" role="alert" data-testid="telegram-notifications-save-error">
              {t('telegramNotifications.saveError')}
            </p>
          ) : null}

          <WriteAccessCard slot="settings" />
        </>
      )}
    </section>
  );
}

export default TelegramNotificationsSection;
