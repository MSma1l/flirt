/**
 * Bara de taburi, în stilul temei Telegram.
 *
 * Culorile vin din variabilele scrise de `theme/applyTheme.ts` la fiecare
 * `themeChanged`, deci bara urmează tema clientului fără cod propriu.
 * Marginea de jos folosește `--safe-bottom` (raportată de Telegram, cu revenire
 * pe `env(safe-area-inset-bottom)`) — altfel, pe un iPhone, ultimul tab ar sta
 * sub bara de gesturi și ar fi imposibil de apăsat.
 *
 * ICONIȚELE sunt desene SVG din `components/icons`, nu caractere text. Un glif
 * („✉", „☺") se randează cu fontul sistemului: altă formă pe iOS decât pe
 * Android, altă grosime decât a vecinilor și alt centru optic, deci bara arăta
 * strâmbă și improvizată. Desenele au aceeași fereastră de 24×24 și aceeași
 * grosime de linie, deci se aliniază între ele pe orice platformă.
 */
import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';

import { haptic } from '@/telegram/bridge';

import { Icon, type IconName } from './icons';

export interface TabItem {
  to: string;
  labelKey: string;
  icon: IconName;
}

/** Taburile de nivel întâi. Ordinea e cea din produs: căutare → relație → tine. */
// Cinci destinații, alese după cât de des ajunge un utilizator la ele, nu după
// importanța lor în specificație. Evenimentele sunt un pilon al produsului, deci
// merită un tab. Setările au trecut în meniu: se intră acolo rar, iar un tab
// permanent pentru ele ar fi luat locul a ceva folosit zilnic.
//
// Fiecare desen e ales ca să nu semene cu vecinii lui: evenimentele sunt un
// calendar, nu o stea (steaua rămâne pentru „Favorite", în meniu), iar profilul
// e o siluetă, nu un zâmbet (zâmbetul e testul de umor).
export const TABS: TabItem[] = [
  { to: '/feed', labelKey: 'nav.feed', icon: 'heart' },
  { to: '/events', labelKey: 'nav.events', icon: 'calendar' },
  { to: '/mesaje', labelKey: 'nav.chats', icon: 'chat' },
  { to: '/profil', labelKey: 'nav.profile', icon: 'person' },
  { to: '/meniu', labelKey: 'nav.more', icon: 'menu' },
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
          {({ isActive }) => (
            <>
              <span className="tab__icon">
                <Icon name={tab.icon} active={isActive} />
              </span>
              <span className="tab__label">{t(tab.labelKey)}</span>
              {/*
               * AL DOILEA SEMNAL al tabului activ, pe lângă linia mai groasă a
               * iconiței. Roz pe gri e singura diferență pentru un ochi care
               * distinge culorile; pentru unul care nu le distinge, roz și gri
               * au aproape aceeași luminozitate, deci tabul activ ar dispărea.
               *
               * Bara stă MEREU în DOM, doar ascunsă: dacă ar apărea la
               * schimbarea tabului, ar împinge eticheta cu câțiva pixeli, iar
               * întreaga bară ar tresări la fiecare apăsare.
               */}
              <span className="tab__indicator" aria-hidden="true" data-active={isActive ? 'true' : 'false'} />
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export default TabBar;
