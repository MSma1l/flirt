/**
 * Meniul „Mai multe": punctul de intrare către ecranele care nu merită un tab.
 *
 * Bara de taburi are loc pentru cinci destinații, iar produsul are mai multe
 * ecrane decât atât. Ele nu sunt secundare ca importanță, ci ca frecvență: un
 * utilizator intră zilnic în feed și în mesaje, dar rar în biletul lui sau în
 * lista de blocare.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { BLOCKLIST_PATH, FAVORITES_PATH } from '@/features/social/socialRoutes';
import { HUMOR_PATH } from '@/features/humor/humorRoutes';
import { PASSPORT_PATH } from '@/features/passport/passportRoutes';
import { SETTINGS_PATH } from '@/features/onboarding/paths';
import { STORIES_PATH } from '@/features/stories/storyRoutes';
import { SUBSCRIPTION_PATH } from '@/features/subscription/subscriptionRoutes';
import { TICKETS_PATH } from '@/features/tickets/ticketRoutes';

/** Calea meniului. Stă aici, lângă ecran, ca restul rutelor lângă ale lor. */
export const MORE_PATH = '/meniu';

interface MenuEntry {
  to: string;
  labelKey: string;
  icon: string;
}

/** Ordinea urmează cât de des ajunge un utilizator la fiecare, nu alfabetul. */
const ENTRIES: MenuEntry[] = [
  { to: STORIES_PATH, labelKey: 'nav.stories', icon: '◎' },
  { to: FAVORITES_PATH, labelKey: 'nav.favorites', icon: '★' },
  { to: HUMOR_PATH, labelKey: 'nav.humor', icon: '☺' },
  { to: PASSPORT_PATH, labelKey: 'nav.passport', icon: '❖' },
  { to: TICKETS_PATH, labelKey: 'nav.tickets', icon: '▣' },
  { to: SUBSCRIPTION_PATH, labelKey: 'nav.subscription', icon: '✦' },
  { to: BLOCKLIST_PATH, labelKey: 'nav.blocklist', icon: '⊘' },
  { to: SETTINGS_PATH, labelKey: 'nav.settings', icon: '⚙' },
];

export function MoreScreen() {
  const { t } = useTranslation('miniapp');

  return (
    <div className="more-screen">
      <h1 className="more-screen__title">{t('nav.more')}</h1>
      <nav className="more-list" aria-label={t('nav.more')}>
        {ENTRIES.map((entry) => (
          <Link key={entry.to} to={entry.to} className="more-item">
            <span className="more-item__icon" aria-hidden="true">
              {entry.icon}
            </span>
            <span className="more-item__label">{t(entry.labelKey)}</span>
            <span className="more-item__chevron" aria-hidden="true">
              ›
            </span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

export default MoreScreen;
