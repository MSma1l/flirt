/**
 * Cadrul aplicației normale: conținutul rutei curente + bara de taburi.
 *
 * Conținutul e singurul care derulează (`overflow-y: auto`); `body` are scroll
 * blocat, ca un gest de swipe pe deck să nu miște pagina sub card.
 */
import { Outlet } from 'react-router';

import { TabBar } from './TabBar';

export function AppShell() {
  return (
    <div className="app-shell">
      <main className="app-shell__content">
        <Outlet />
      </main>
      <TabBar />
    </div>
  );
}

export default AppShell;
