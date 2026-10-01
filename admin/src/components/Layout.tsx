/**
 * Cadrul panoului: bară laterală de navigare + antet.
 * Coada de moderare afișează numărul de rapoarte în așteptare — Apple cere
 * răspuns la raportări în ≤24h, deci cifra trebuie să fie vizibilă permanent.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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
      { to: '/scan', key: 'scan' },
    ],
  },
  {
    key: 'ads',
    items: [{ to: '/ads', key: 'ads' }],
  },
];

const NAV_ITEMS: readonly NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

// Secțiunile închise de admin; preferință de UI, deci `localStorage` e potrivit.
const COLLAPSED_STORAGE_KEY = 'flirt_admin_nav_collapsed';

function readCollapsed(): SectionKey[] {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const known = NAV_SECTIONS.map((section) => section.key);
    return Array.isArray(parsed)
      ? parsed.filter((key): key is SectionKey => known.includes(key as SectionKey))
      : [];
  } catch {
    return [];
  }
}

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
  const [collapsed, setCollapsed] = useState<SectionKey[]>(readCollapsed);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(collapsed));
    } catch {
      // Persistența meniului e opțională.
    }
  }, [collapsed]);

  const toggleSection = (key: SectionKey): void => {
    setCollapsed((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    );
  };

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

  const countFor = (to: string): number =>
    to === '/moderation' ? pending : to === '/ticket-orders' ? ticketsToReview : 0;

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar__brand">
          FLIRT <span>admin</span>
        </div>
        <nav className="sidebar__nav">
          {NAV_SECTIONS.map((section) => {
            const isOpen = !collapsed.includes(section.key);
            // O secțiune închisă nu are voie să ascundă ce așteaptă răspuns:
            // totalul contoarelor ei urcă pe titlu.
            const hiddenCount = isOpen
              ? 0
              : section.items.reduce((sum, item) => sum + countFor(item.to), 0);
            const itemsId = `sidebar-section-${section.key}`;
            return (
              <div key={section.key} className="sidebar__section">
                <button
                  type="button"
                  className="sidebar__section-title"
                  aria-expanded={isOpen}
                  aria-controls={itemsId}
                  onClick={() => toggleSection(section.key)}
                >
                  <span>{m.sections[section.key]}</span>
                  <span className="sidebar__section-meta">
                    {hiddenCount > 0 ? <Badge tone="count">{hiddenCount}</Badge> : null}
                    <svg
                      className={
                        isOpen ? 'sidebar__chevron sidebar__chevron--open' : 'sidebar__chevron'
                      }
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      aria-hidden="true"
                    >
                      <path
                        d="M3 4.5 6 7.5 9 4.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </button>
                {isOpen ? (
                  <div id={itemsId} className="sidebar__section-items">
                    {section.items.map((item) => {
                      const count = countFor(item.to);
                      return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          className={({ isActive }) =>
                            isActive ? 'sidebar__link sidebar__link--active' : 'sidebar__link'
                          }
                        >
                          <span>{m.nav[item.key]}</span>
                          {count > 0 ? <Badge tone="count">{count}</Badge> : null}
                        </NavLink>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
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
