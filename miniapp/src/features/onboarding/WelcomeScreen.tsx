/**
 * Ecranul de bun venit — exact ce a cerut proprietarul:
 * „dacă nu am cont, să fie un buton care mă înregistrează, se pun datele
 * Telegramului și gata".
 *
 * Arată numele și poza din Telegram și are UN buton mare. Fără parolă, fără
 * email, fără cod pe SMS: contul EXISTĂ deja (a fost creat la
 * `POST /auth/telegram`), ce lipsește e profilul. Butonul duce mai departe cu
 * datele Telegramului deja completate.
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { haptic } from '@/telegram/bridge';
import { useTelegramMainButton } from '@/telegram/useTelegram';

import { telegramIdentity } from './telegramPrefill';
import { ONBOARDING_PROFILE_PATH } from './paths';

export function WelcomeScreen() {
  const { t } = useTranslation('miniapp');
  const navigate = useNavigate();
  const identity = telegramIdentity();

  const start = useCallback(() => {
    haptic('medium');
    void navigate(ONBOARDING_PROFILE_PATH);
  }, [navigate]);

  // Butonul principal NATIV al Telegramului (bara de jos a clientului). În
  // browser e un no-op, de aceea butonul din DOM rămâne acolo unde e.
  useTelegramMainButton({ text: t('welcome.cta'), onClick: start });

  const name = identity?.firstName || identity?.fullName || '';

  return (
    <div className="screen-center welcome">
      {identity?.photoUrl ? (
        <img
          className="welcome__avatar"
          src={identity.photoUrl}
          alt=""
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="welcome__avatar welcome__avatar--empty" aria-hidden="true">
          {(name[0] ?? '?').toUpperCase()}
        </div>
      )}

      <h1 className="title">
        {name ? t('welcome.titleNamed', { name }) : t('welcome.title')}
      </h1>
      <p className="body-text">{t('welcome.body')}</p>

      <button type="button" className="button button--wide" onClick={start} data-testid="welcome-cta">
        {t('welcome.cta')}
      </button>

      <p className="caption">{t('welcome.note')}</p>
    </div>
  );
}

export default WelcomeScreen;
