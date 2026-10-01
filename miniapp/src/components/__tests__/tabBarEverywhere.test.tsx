/**
 * Bara de taburi NU dispare pe niciun ecran al aplicației normale.
 *
 * Defectul raportat de proprietar: ecranele „în adâncime" (eveniment,
 * conversație, pașaport, bilete, setări...) erau rute-surori ale layout-ului
 * `AppShell`, deci se randau fără bară. Testăm prin `AppRoutes`, exact cum
 * ajunge un utilizator acolo, și verificăm și tabul aprins pe fiecare.
 */
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/api/client';
import { useAuthStore } from '@/auth/authStore';
import { httpError, renderRouted } from '@/features/onboarding/__tests__/testUtils';
import i18n from '@/i18n';
import { AppRoutes } from '@/routes';

import { TABS } from '../TabBar';

vi.mock('@mobile/features/feed/feedApi', () => ({
  fetchFeed: vi.fn(async () => []),
  swipe: vi.fn(),
  undoSwipe: vi.fn(),
}));

beforeEach(() => {
  useAuthStore.setState({ status: 'idle', user: null, error: null, optimisticName: null });
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/auth/me') {
      return { data: { id: 'u1', email: 'a@b.c', profile_completed: true } } as never;
    }
    throw httpError(404);
  });
  vi.spyOn(api, 'post').mockRejectedValue(httpError(404));
});

function label(to: string): string {
  const tab = TABS.find((t) => t.to === to)!;
  return i18n.t(tab.labelKey, { ns: 'miniapp' });
}

const CASES: [path: string, activeTab: string][] = [
  ['/feed', '/feed'],
  ['/events/ev-123', '/events'],
  ['/events/ev-123/ticket-request', '/events'],
  ['/mesaje/chat-42', '/mesaje'],
  ['/passport', '/meniu'],
  ['/tickets', '/meniu'],
  ['/setari', '/meniu'],
  ['/subscription', '/meniu'],
  ['/stories', '/feed'],
  ['/verificare', '/profil'],
];

describe('bara de taburi pe toate ecranele', () => {
  it.each(CASES)('%s are bara, cu tabul %s aprins', async (path, activeTab) => {
    renderRouted(<AppRoutes />, [path]);

    const bar = await screen.findByRole('navigation', { name: i18n.t('nav.label', { ns: 'miniapp' }) });
    const links = within(bar).getAllByRole('link');
    expect(links).toHaveLength(TABS.length);

    const active = links.filter((l) => l.classList.contains('tab--active'));
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent(label(activeTab));
  });
});
