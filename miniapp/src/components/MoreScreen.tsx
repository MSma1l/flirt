/**
 * Meniul „Mai multe": punctul de intrare către ecranele care nu merită un tab.
 *
 * Bara de taburi are loc pentru cinci destinații, iar produsul are mai multe
 * ecrane decât atât. Ele nu sunt secundare ca importanță, ci ca frecvență: un
 * utilizator intră zilnic în feed și în mesaje, dar rar în biletul lui sau în
 * lista de blocare.
 *
 * Fiecare rând are o iconiță desenată (`components/icons`), nu un caracter
 * decorativ: „❖", „▣" sau „⊘" nu există în toate fonturile de sistem, deci pe
 * unele telefoane rândul rămânea cu un pătrat gol în locul simbolului.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Icon, type IconName } from './icons';

import { BLOCKLIST_PATH, FAVORITES_PATH } from '@/features/social/socialRoutes';
import { HUMOR_PATH } from '@/features/humor/humorRoutes';
import { PASSPORT_PATH } from '@/features/passport/passportRoutes';
import { SETTINGS_PATH } from '@/features/onboarding/paths';
import { SUBSCRIPTION_PATH } from '@/features/subscription/subscriptionRoutes';
import { TICKETS_PATH } from '@/features/tickets/ticketRoutes';

/** Calea meniului. Stă aici, lângă ecran, ca restul rutelor lângă ale lor. */
export const MORE_PATH = '/meniu';

interface MenuEntry {
  to: string;
  labelKey: string;
  icon: IconName;
}

/** Ordinea urmeaza cat de des ajunge un utilizator la fiecare, nu alfabetul.
 *
 * Povestile NU sunt aici: bara lor sta in capul ecranului de anchete, ca pe
 * nativ. O a doua intrare spre acelasi lucru l-ar face pe utilizator sa se
 * intrebe care dintre ele e cea adevarata. Ruta ramane inregistrata, ca
 * linkurile directe deja trimise sa nu se rupa. */
export const MENU_ENTRIES: MenuEntry[] = [
  { to: FAVORITES_PATH, labelKey: 'nav.favorites', icon: 'star' },
  { to: HUMOR_PATH, labelKey: 'nav.humor', icon: 'smile' },
  { to: PASSPORT_PATH, labelKey: 'nav.passport', icon: 'passport' },
  { to: TICKETS_PATH, labelKey: 'nav.tickets', icon: 'ticket' },
  { to: SUBSCRIPTION_PATH, labelKey: 'nav.subscription', icon: 'crown' },
  { to: BLOCKLIST_PATH, labelKey: 'nav.blocklist', icon: 'block' },
  { to: SETTINGS_PATH, labelKey: 'nav.settings', icon: 'settings' },
];

export function MoreScreen() {
  const { t } = useTranslation('miniapp');

  return (
    <div className="more-screen">
      <h1 className="more-screen__title">{t('nav.more')}</h1>
      <nav className="more-list" aria-label={t('nav.more')}>
        {MENU_ENTRIES.map((entry) => (
          <Link key={entry.to} to={entry.to} className="more-item">
            <span className="more-item__icon">
              <Icon name={entry.icon} />
            </span>
            <span className="more-item__label">{t(entry.labelKey)}</span>
            <Icon name="chevron" className="more-item__chevron" />
          </Link>
        ))}
      </nav>
    </div>
  );
}

export default MoreScreen;
