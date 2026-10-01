/**
 * Cadrul panoului: bară laterală de navigare + antet.
 * Coada de moderare afișează numărul de rapoarte în așteptare — Apple cere
 * răspuns la raportări în ≤24h, deci cifra trebuie să fie vizibilă permanent.
 */
import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { fetchStats, fetchTicketOrders } from '../api/admin';
import { useAuth } from '../auth/AuthContext';
import { LANGUAGES, useLanguage, useMessages } from '../i18n/LanguageContext';
import { layoutMessages } from '../i18n/messages/layout';
import { useTheme } from '../theme/ThemeContext';
import { Badge, Button } from './ui';

type NavKey = keyof (typeof layoutMessages)['ro']['nav'];
type SectionKey = keyof (typeof layoutMessages)['ro']['sections'];

interface NavItem {
  to: string;
  key: NavKey;
}

interface NavSection {
  key: SectionKey;
  items: readonly NavItem[];
}

// Meniul e împărțit pe teme, ca fiecare zonă de lucru să fie găsită dintr-o privire.
// Etichetele vin din `i18n/messages/layout.ts`, în limba activă.
const NAV_SECTIONS: readonly NavSection[] = [
  {
    key: 'general',
    items: [
      { to: '/dashboard', key: 'dashboard' },
      { to: '/moderation', key: 'moderation' },
    ],
  },
  {
    key: 'users',
    items: [
      { to: '/users', key: 'users' },
      { to: '/subscriptions', key: 'subscriptions' },
      { to: '/invites', key: 'invites' },
    ],
  },
  {
    key: 'events',
    items: [
      { to: '/events', key: 'events' },
      { to: '/loyalty', key: 'loyalty' },
    ],
  },
  {
    key: 'tickets',
    items: [
      { to: '/ticket-orders', key: 'ticketOrders' },
      { to: '/ticket-requests', key: 'ticketRequests' },
    ],
  },
  {
    key: 'ads',
    items: [{ to: '/ads', key: 'ads' }],
  },
];

const NAV_ITEMS: readonly NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

function titleKeyFor(pathname: string): NavKey {
  const item = NAV_ITEMS.find((entry) => pathname.startsWith(entry.to));
  return item?.key ?? 'dashboard';
}

export function Layout(): JSX.Element {
  const { admin, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { language, setLanguage } = useLanguage();
  const m = useMessages(layoutMessages);
  const location = useLocation();

  // Contorul de rapoarte deschise; eșecul lui nu are voie să rupă navigarea.
  const statsQuery = useQuery({
    queryKey: ['stats'],
    queryFn: fetchStats,
    refetchInterval: 60_000,
    retry: 1,
  });
  const pending = statsQuery.data?.reports_pending ?? 0;

  // Câte comenzi de bilete așteaptă verificarea (status `payment_declared`).
  // Eșecul acestei cereri nu are voie să rupă navigarea.
  const ticketOrdersQuery = useQuery({
    queryKey: ['ticket-orders'],
    queryFn: fetchTicketOrders,
    refetchInterval: 60_000,
    retry: 1,
  });
  const ticketsToReview =
    ticketOrdersQuery.data?.filter((order) => order.status === 'payment_declared').length ?? 0;

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar__brand">
          FLIRT <span>admin</span>
        </div>
        <nav className="sidebar__nav">
          {NAV_SECTIONS.map((section) => (
            <div key={section.key} className="sidebar__section">
              <div className="sidebar__section-title">{m.sections[section.key]}</div>
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    isActive ? 'sidebar__link sidebar__link--active' : 'sidebar__link'
                  }
                >
                  <span>{m.nav[item.key]}</span>
                  {item.to === '/moderation' && pending > 0 ? (
                    <Badge tone="count">{pending}</Badge>
                  ) : null}
                  {item.to === '/ticket-orders' && ticketsToReview > 0 ? (
                    <Badge tone="count">{ticketsToReview}</Badge>
                  ) : null}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar__footer">
          {admin?.email ? <span className="muted">{admin.email}</span> : null}
          <Button variant="ghost" small onClick={signOut}>
            {m.signOut}
          </Button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1 className="topbar__title">{m.nav[titleKeyFor(location.pathname)]}</h1>
          <div className="topbar__actions">
            <div className="lang-switch" role="group" aria-label={m.languageLabel}>
              {LANGUAGES.map((code) => (
                <button
                  key={code}
                  type="button"
                  className={code === language ? 'lang-switch__btn lang-switch__btn--on' : 'lang-switch__btn'}
                  aria-pressed={code === language}
                  onClick={() => setLanguage(code)}
                >
                  {code.toUpperCase()}
                </button>
              ))}
            </div>
            <Button variant="ghost" small onClick={toggleTheme} aria-label={m.themeToggle}>
              {theme === 'dark' ? m.themeLight : m.themeDark}
            </Button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
