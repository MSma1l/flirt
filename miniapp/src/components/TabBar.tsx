/**
 * Bara de taburi, în stilul temei Telegram.
 *
 * Culorile vin din variabilele scrise de `theme/applyTheme.ts` la fiecare
 * `themeChanged`, deci bara urmează tema clientului fără cod propriu.
 * Marginea de jos folosește `--safe-bottom` (raportată de Telegram, cu revenire
 * pe `env(safe-area-inset-bottom)`) — altfel, pe un iPhone, ultimul tab ar sta
 * sub bara de gesturi și ar fi imposibil de apăsat.
 */
import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';

import { haptic } from '@/telegram/bridge';

export interface TabItem {
  to: string;
  labelKey: string;
  icon: string;
}

/** Taburile de nivel întâi. Ordinea e cea din produs: căutare → relație → tine. */
export const TABS: TabItem[] = [
  { to: '/feed', labelKey: 'nav.feed', icon: '♥' },
  { to: '/mesaje', labelKey: 'nav.chats', icon: '✉' },
  { to: '/profil', labelKey: 'nav.profile', icon: '☺' },
  { to: '/setari', labelKey: 'nav.settings', icon: '⚙' },
];

export function TabBar() {
  const { t } = useTranslation('miniapp');

  return (
    <nav className="tab-bar" aria-label={t('nav.label')}>
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) => (isActive ? 'tab tab--active' : 'tab')}
          onClick={() => haptic('light')}
        >
          <span className="tab__icon" aria-hidden="true">
            {tab.icon}
          </span>
          <span className="tab__label">{t(tab.labelKey)}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export default TabBar;
