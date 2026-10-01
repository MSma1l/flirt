/**
 * Ecranele legale din aplicație: cititorul (sub bara de taburi), centrul de
 * confidențialitate (copia datelor, retragerea consimțământului pentru selfie),
 * secțiunea din Setări și intrarea din meniu.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/api/client';
import { useAuthStore } from '@/auth/authStore';
import { MENU_ENTRIES, MoreScreen } from '@/components/MoreScreen';
import { httpError, renderRouted } from '@/features/onboarding/__tests__/testUtils';
import { AppRoutes } from '@/routes';

import type { ConsentStatus } from '../legalApi';
import { LEGAL_HUB_PATH } from '../legalRoutes';
import { LegalSettingsSection } from '../LegalSettingsSection';

vi.mock('@mobile/features/feed/feedApi', () => ({
  fetchFeed: vi.fn(async () => []),
  swipe: vi.fn(),
  undoSwipe: vi.fn(),
}));

const STATUS: ConsentStatus = {
  consent_required: false,
  required_documents: ['terms', 'privacy'],
  current_versions: { terms: '1.0', privacy: '1.0', sensitive_data: '1.0' },
  accepted: {
    terms: { version: '1.0', accepted_at: '2026-10-01T10:00:00Z', withdrawn_at: null },
    privacy: { version: '1.0', accepted_at: '2026-10-01T10:00:00Z', withdrawn_at: null },
    sensitive_data: { version: '1.0', accepted_at: '2026-10-01T10:00:00Z', withdrawn_at: null },
  },
  sensitive_data_consent: true,
};

const TERMS = {
  document: 'terms',
  lang: 'ro',
  version: '1.0',
  effective_date: '2026-08-23',
  title: 'Termenii de utilizare',
  content: '# Termenii de utilizare\n\n## 1. Reguli\n\n- **18+** doar\n- Respect',
};

const EXPORT = { account: { id: 'u1' }, profile: { name: 'Ana' } };

function mockServer() {
  const get = vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/auth/me') {
      return {
        data: { id: 'u1', email: 'a@b.c', profile_completed: true, consent_required: false },
      } as never;
    }
    if (url === '/legal/consent-status') return { data: STATUS } as never;
    if (url === '/legal/documents/terms') return { data: TERMS } as never;
    if (url === '/me/export') return { data: EXPORT } as never;
    throw httpError(404);
  });
  const post = vi.spyOn(api, 'post').mockImplementation(async (url: string) => {
    if (url === '/legal/consent/withdraw') {
      return {
        data: { ...STATUS, sensitive_data_consent: false, accepted: { ...STATUS.accepted, sensitive_data: null } },
      } as never;
    }
    throw httpError(404);
  });
  return { get, post };
}

beforeEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ status: 'idle', user: null, error: null, optimisticName: null });
});

describe('cititorul în aplicație', () => {
  it('randează documentul cu versiunea și data, sub bara de taburi', async () => {
    mockServer();
    renderRouted(<AppRoutes />, ['/legal/terms']);

    expect(await screen.findByTestId('legal-doc-terms')).toBeInTheDocument();
    expect(screen.getByTestId('legal-doc-meta')).toHaveTextContent('Versiunea 1.0');
    expect(screen.getByTestId('legal-doc-meta')).toHaveTextContent('2026');
    expect(screen.getByRole('heading', { name: '1. Reguli' })).toBeInTheDocument();
    expect(screen.getByText('18+').tagName).toBe('STRONG');
    // Bara de taburi rămâne vizibilă.
    expect(screen.getByRole('navigation', { name: /./ })).toBeInTheDocument();
  });

  it('o eroare de încărcare are reîncercare', async () => {
    const { get } = mockServer();
    get.mockImplementation(async (url: string) => {
      if (url === '/auth/me') {
        return { data: { id: 'u1', email: 'a@b.c', profile_completed: true } } as never;
      }
      throw httpError(500);
    });
    renderRouted(<AppRoutes />, ['/legal/terms']);

    expect(await screen.findByTestId('legal-doc-retry')).toBeInTheDocument();
  });
});

describe('centrul de confidențialitate', () => {
  it('descarcă datele și oferă copierea lor', async () => {
    const { get } = mockServer();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderRouted(<AppRoutes />, [LEGAL_HUB_PATH]);

    await userEvent.click(await screen.findByTestId('export-data'));

    expect(await screen.findByTestId('export-ready')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/me/export');
    await userEvent.click(screen.getByTestId('export-copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(JSON.stringify(EXPORT, null, 2)));
    expect(await screen.findByTestId('export-copied')).toBeInTheDocument();
  });

  it('retrage consimțământul pentru selfie', async () => {
    const { post } = mockServer();
    renderRouted(<AppRoutes />, [LEGAL_HUB_PATH]);

    await userEvent.click(await screen.findByTestId('withdraw-sensitive'));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/legal/consent/withdraw', { documents: ['sensitive_data'] }),
    );
    expect(await screen.findByTestId('sensitive-not-given')).toBeInTheDocument();
  });

  it('are legături spre documente și spre ștergerea contului', async () => {
    mockServer();
    renderRouted(<AppRoutes />, [LEGAL_HUB_PATH]);

    expect(await screen.findByTestId('privacy-center-doc-privacy')).toHaveAttribute('href', '/legal/privacy');
    expect(screen.getByTestId('privacy-center-doc-terms')).toHaveAttribute('href', '/legal/terms');
    expect(screen.getByTestId('privacy-center-delete')).toHaveAttribute('href', '/setari');
  });
});

describe('intrările din Setări și din meniu', () => {
  it('Setări: Politica, Termenii și centrul de confidențialitate', () => {
    renderRouted(<LegalSettingsSection />);

    expect(screen.getByTestId('settings-legal-privacy')).toHaveAttribute('href', '/legal/privacy');
    expect(screen.getByTestId('settings-legal-terms')).toHaveAttribute('href', '/legal/terms');
    expect(screen.getByTestId('settings-legal-center')).toHaveAttribute('href', LEGAL_HUB_PATH);
  });

  it('meniul are intrarea „Confidențialitate și date"', () => {
    expect(MENU_ENTRIES.some((e) => e.to === LEGAL_HUB_PATH)).toBe(true);
    renderRouted(<MoreScreen />);
    expect(screen.getByRole('link', { name: 'Confidențialitate și date' })).toHaveAttribute(
      'href',
      LEGAL_HUB_PATH,
    );
  });
});
