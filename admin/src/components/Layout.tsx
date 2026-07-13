/**
 * Cadrul panoului: bară laterală de navigare + antet.
 * Coada de moderare afișează numărul de rapoarte în așteptare — Apple cere
 * răspuns la raportări în ≤24h, deci cifra trebuie să fie vizibilă permanent.
 */
import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { fetchStats } from '../api/admin';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { Badge, Button } from './ui';

interface NavItem {
  to: string;
  label: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { to: '/dashboard', label: 'Panou' },
  { to: '/moderation', label: 'Moderare' },
  { to: '/users', label: 'Utilizatori' },
  { to: '/events', label: 'Evenimente' },
  { to: '/subscriptions', label: 'Abonamente' },
] as const;

function titleFor(pathname: string): string {
  const item = NAV_ITEMS.find((entry) => pathname.startsWith(entry.to));
  return item?.label ?? 'Panou';
}

export function Layout(): JSX.Element {
  const { admin, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();

  // Contorul de rapoarte deschise; eșecul lui nu are voie să rupă navigarea.
  const statsQuery = useQuery({
    queryKey: ['stats'],
    queryFn: fetchStats,
    refetchInterval: 60_000,
    retry: 1,
  });
  const pending = statsQuery.data?.reports_pending ?? 0;

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar__brand">
          FLIRT <span>admin</span>
        </div>
        <nav className="sidebar__nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive ? 'sidebar__link sidebar__link--active' : 'sidebar__link'
              }
            >
              <span>{item.label}</span>
              {item.to === '/moderation' && pending > 0 ? (
                <Badge tone="count">{pending}</Badge>
              ) : null}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__footer">
          {admin?.email ? <span className="muted">{admin.email}</span> : null}
          <Button variant="ghost" small onClick={signOut}>
            Ieși din cont
          </Button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1 className="topbar__title">{titleFor(location.pathname)}</h1>
          <Button
            variant="ghost"
            small
            onClick={toggleTheme}
            aria-label="Schimbă tema"
          >
            {theme === 'dark' ? 'Temă deschisă' : 'Temă întunecată'}
          </Button>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
