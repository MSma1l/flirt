/**
 * Centrul de activitate + badge-ul de necitite.
 *
 * Ce apărăm:
 *   - statisticile se afișează exact cum vin de la server;
 *   - cronologia: match (cu legătură spre conversație), like, super like,
 *     vizualizări agregate — și NICIUN rând de dislike;
 *   - la deschidere semnul de citire se mută până la cel mai nou element
 *     afișat, dar rândurile rămân marcate „Nou" cât timp ecranul e deschis;
 *   - badge-ul apare pe tabul meniului și pe rândul „Activitate", fără să
 *     schimbe numele accesibil al legăturilor.
 */
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

import i18n from '@/i18n';
import { renderWithProviders } from '@/test/harness';

// Primul test încarcă la rece ecranul + i18n; pe o mașină încărcată 1s nu
// ajunge. Așteptarea mai lungă nu ascunde nimic: aserțiile rămân aceleași.
configure({ asyncUtilTimeout: 10_000 });

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

const { api } = await import('@/api/client');
const { ActivityScreen } = await import('../ActivityScreen');
const { MoreScreen } = await import('@/components/MoreScreen');
const { TabBar } = await import('@/components/TabBar');

const NOW = new Date();
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

const PAGE = {
  stats: {
    views_total: 42,
    views_last_7_days: 9,
    likes: 7,
    super_likes: 2,
    dislikes: 5,
    matches: 3,
  },
  items: [
    {
      id: 'match:m1',
      kind: 'match',
      occurred_at: minutesAgo(1),
      is_read: false,
      actor: { user_id: 'u-ana', name: 'Ana', age: 24, photo: 'https://cdn/ana.jpg' },
      chat_id: 'chat-1',
    },
    {
      id: 'like:l1',
      kind: 'super_like',
      occurred_at: minutesAgo(30),
      is_read: false,
      actor: { user_id: 'u-bia', name: 'Bianca', age: 26, photo: null },
    },
    {
      id: 'views:2026-10-19',
      kind: 'views',
      occurred_at: minutesAgo(90),
      is_read: true,
      count: 4,
    },
    {
      id: 'like:l2',
      kind: 'like',
      occurred_at: minutesAgo(60 * 30),
      is_read: true,
      actor: { user_id: 'u-cris', name: 'Cristina', age: 22, photo: null },
    },
  ],
  next_cursor: null,
  unread: 2,
};

function routeGet(map: Record<string, unknown>) {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url in map) {
      const value = map[url];
      if (value instanceof Error) throw value;
      return { data: value };
    }
    throw new Error(`neașteptat: ${url}`);
  });
}

function renderAt(ui: React.ReactElement, path = '/activitate') {
  return renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/activitate" element={ui} />
        <Route path="/meniu" element={ui} />
        <Route path="/feed" element={ui} />
        <Route path="/mesaje/:chatId" element={<p data-testid="chat-opened">chat</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const tr = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'miniapp', ...opts });

beforeEach(() => {
  void i18n.changeLanguage('ro');
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.post).mockResolvedValue({ data: { unread: 0 } });
});

describe('ecranul de activitate', () => {
  it('arată statisticile primite de la server', async () => {
    routeGet({ '/notifications/activity': PAGE });
    renderAt(<ActivityScreen />);

    const stats = await screen.findByTestId('activity-stats');
    expect(within(stats).getByTestId('activity-stat-views')).toHaveTextContent('42');
    expect(within(stats).getByTestId('activity-stat-views-week')).toHaveTextContent(
      tr('activity.stats.viewsWeek', { count: 9 }),
    );
    expect(within(stats).getByTestId('activity-stat-likes')).toHaveTextContent('7');
    expect(within(stats).getByTestId('activity-stat-superLikes')).toHaveTextContent('2');
    expect(within(stats).getByTestId('activity-stat-dislikes')).toHaveTextContent('5');
    expect(within(stats).getByTestId('activity-stat-matches')).toHaveTextContent('3');
  });

  it('listează evenimentele, fără rânduri de dislike, cu match-ul legat de conversație', async () => {
    routeGet({ '/notifications/activity': PAGE });
    renderAt(<ActivityScreen />);

    const rows = await screen.findAllByTestId('activity-row');
    expect(rows.map((r) => r.getAttribute('data-kind'))).toEqual([
      'match',
      'super_like',
      'views',
      'like',
    ]);
    expect(screen.getByText(tr('activity.item.match', { name: 'Ana' }))).toBeInTheDocument();
    expect(screen.getByText(tr('activity.item.super_like', { name: 'Bianca' }))).toBeInTheDocument();
    expect(screen.getByText(tr('activity.item.views', { count: 4 }))).toBeInTheDocument();

    // Rândul de match deschide conversația.
    fireEvent.click(within(rows[0]!).getByRole('link'));
    expect(await screen.findByTestId('chat-opened')).toBeInTheDocument();
  });

  it('marchează citit până la cel mai nou element, dar păstrează „Nou" pe ecran', async () => {
    routeGet({ '/notifications/activity': PAGE });
    renderAt(<ActivityScreen />);

    await screen.findAllByTestId('activity-row');
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/notifications/activity/read', {
        up_to: PAGE.items[0]!.occurred_at,
      }),
    );
    const unread = screen
      .getAllByTestId('activity-row')
      .filter((r) => r.getAttribute('data-unread') === 'true');
    expect(unread).toHaveLength(2);
    expect(screen.getAllByText(tr('activity.new'))).toHaveLength(2);
  });

  it('nu cere marcare când nu e nimic necitit', async () => {
    routeGet({ '/notifications/activity': { ...PAGE, unread: 0 } });
    renderAt(<ActivityScreen />);
    await screen.findAllByTestId('activity-row');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('starea goală explică ce va apărea aici', async () => {
    routeGet({
      '/notifications/activity': { ...PAGE, items: [], unread: 0 },
    });
    renderAt(<ActivityScreen />);
    expect(await screen.findByTestId('activity-empty')).toHaveTextContent(
      tr('activity.emptyTitle'),
    );
  });

  it('o eroare de rețea oferă reîncercare', async () => {
    routeGet({ '/notifications/activity': new Error('offline') });
    renderAt(<ActivityScreen />);
    expect(await screen.findByTestId('activity-error')).toBeInTheDocument();

    routeGet({ '/notifications/activity': PAGE });
    fireEvent.click(screen.getByTestId('activity-retry'));
    expect(await screen.findByTestId('activity-stats')).toBeInTheDocument();
  });
});

describe('badge-ul de necitite', () => {
  it('apare pe tabul meniului, fără să schimbe numele legăturii', async () => {
    routeGet({ '/notifications/activity/unread': { unread: 3 } });
    renderAt(<TabBar />, '/feed');

    expect(await screen.findByTestId('tab-activity-badge')).toHaveTextContent('3');
    expect(screen.getByRole('link', { name: tr('nav.more') })).toBeInTheDocument();
  });

  it('plafonează la 99+', async () => {
    routeGet({ '/notifications/activity/unread': { unread: 250 } });
    renderAt(<TabBar />, '/feed');
    expect(await screen.findByTestId('tab-activity-badge')).toHaveTextContent('99+');
  });

  it('lipsește când nu e nimic necitit', async () => {
    routeGet({ '/notifications/activity/unread': { unread: 0 } });
    renderAt(<TabBar />, '/feed');
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByTestId('tab-activity-badge')).toBeNull();
  });

  it('rândul „Activitate" din meniu arată numărul și îl descrie accesibil', async () => {
    routeGet({ '/notifications/activity/unread': { unread: 5 } });
    renderAt(<MoreScreen />, '/meniu');

    expect(await screen.findByTestId('menu-activity-badge')).toHaveTextContent('5');
    const link = screen.getByRole('link', { name: tr('nav.activity') });
    expect(link).toHaveAccessibleDescription(tr('activity.unread', { count: 5 }));
  });
});
