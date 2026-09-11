/**
 * Cadrul unui ecran „în adâncime" (o conversație, un pas de înregistrare).
 *
 * Leagă butonul ÎNAPOI NATIV al Telegramului la navigarea înapoi — hook-ul
 * `useTelegramBackButton` exista deja, scris și testat, dar nu era folosit
 * nicăieri. În browser butonul nativ nu apare, de aceea randăm și unul propriu:
 * altfel dezvoltarea locală ar fi o fundătură.
 *
 * Butonul se ascunde singur la demontare (curățarea întoarsă de `showBackButton`),
 * deci ecranele de nivel întâi nu trebuie să facă nimic.
 */
import type { ReactNode } from 'react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useTelegramBackButton } from '@/telegram/useTelegram';

export interface DeepScreenProps {
  children: ReactNode;
  title?: string;
  /** Unde ducem înapoi. Implicit: un pas în istoricul rutelor. */
  onBack?: () => void;
}

export function DeepScreen({ children, title, onBack }: DeepScreenProps) {
  const navigate = useNavigate();
  const { t } = useTranslation('common');

  const goBack = useCallback(() => {
    if (onBack) onBack();
    else void navigate(-1);
  }, [navigate, onBack]);

  useTelegramBackButton(goBack);

  return (
    <div className="app-shell">
      <header className="deep-header">
        <button
          type="button"
          className="deep-header__back"
          onClick={goBack}
          data-testid="deep-back"
        >
          ‹ {t('actions.back')}
        </button>
        {title ? <h1 className="deep-header__title">{title}</h1> : null}
      </header>
      <main className="app-shell__content">{children}</main>
    </div>
  );
}

export default DeepScreen;
