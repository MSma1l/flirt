/**
 * Invitația blândă „Vrei să te anunțăm în Telegram?" — un card în pagină,
 * NU un dialog: nu blochează nimic, se închide cu „Nu acum" și nu mai revine
 * (regulile de afișare stau în `writeAccess.ts`).
 */
import { useTranslation } from 'react-i18next';

import { useWriteAccessPrompt, type WriteAccessSlot } from './writeAccess';

import './notifications.css';

export function WriteAccessCard({ slot }: { slot: WriteAccessSlot }) {
  const { t } = useTranslation('screens');
  const prompt = useWriteAccessPrompt(slot);
  if (!prompt.visible) return null;

  return (
    <div
      className={`tn-card tn-card--${slot}`}
      role="region"
      aria-label={t('telegramNotifications.writeAccess.title')}
      data-testid={`write-access-${slot}`}
    >
      <p className="tn-card__title">{t('telegramNotifications.writeAccess.title')}</p>
      <p className="caption">
        {slot === 'settings'
          ? t('telegramNotifications.writeAccess.settingsBody')
          : t('telegramNotifications.writeAccess.body')}
      </p>
      <div className="tn-card__actions">
        <button
          type="button"
          className="button"
          disabled={prompt.busy}
          onClick={() => void prompt.allow()}
          data-testid={`write-access-${slot}-allow`}
        >
          {t('telegramNotifications.writeAccess.allow')}
        </button>
        <button
          type="button"
          className="button button--ghost"
          disabled={prompt.busy}
          onClick={prompt.dismiss}
          data-testid={`write-access-${slot}-later`}
        >
          {t('telegramNotifications.writeAccess.later')}
        </button>
      </div>
    </div>
  );
}

export default WriteAccessCard;
