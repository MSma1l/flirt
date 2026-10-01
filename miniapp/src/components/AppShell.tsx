/**
 * Cadrul aplicației normale: conținutul rutei curente + bara de taburi.
 *
 * Conținutul e singurul care derulează (`overflow-y: auto`); `body` are scroll
 * blocat, ca un gest de swipe pe deck să nu miște pagina sub card.
 */
import { Outlet, useLocation } from 'react-router';

import { FEED_PATH } from '@/features/onboarding/paths';

import { TabBar } from './TabBar';

export function AppShell() {
  // Feedul e singura rută „pe tot ecranul": poza cardului merge de la marginea
  // de sus până la bara de taburi, fără marginile laterale ale cadrului. Clasa
  // e legată de rută, ca restul ecranelor să rămână exact cum erau.
  const { pathname } = useLocation();
  const bleed = pathname === FEED_PATH;
  return (
    <div className="app-shell">
      <main className={bleed ? 'app-shell__content app-shell__content--bleed' : 'app-shell__content'}>
        <Outlet />
      </main>
      <TabBar />
    </div>
  );
}

export default AppShell;
