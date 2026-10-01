/**
 * POARTA DE CONSIMȚĂMÂNT, testată prin `AppRoutes`, exact cum o vede omul după
 * autentificarea Telegram.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/api/client';
import { useAuthStore } from '@/auth/authStore';
import { CAPABILITIES_PATH } from '@/features/capabilities';
import { httpError, renderRouted } from '@/features/onboarding/__tests__/testUtils';
import { AppRoutes } from '@/routes';

import type { ConsentStatus } from '../legalApi';

vi.mock('@mobile/features/feed/feedApi', () => ({
  fetchFeed: vi.fn(async () => []),
  swipe: vi.fn(),
  undoSwipe: vi.fn(),
}));

const PENDING: ConsentStatus = {
  consent_required: true,
  required_documents: ['terms', 'privacy'],
  current_versions: { terms: '1.0', privacy: '1.0', sensitive_data: '1.0' },
  accepted: { terms: null, privacy: null, sensitive_data: null },
  sensitive_data_consent: false,
};

const ACCEPTED: ConsentStatus = {
  ...PENDING,
  consent_required: false,
  accepted: {
    terms: { version: '1.0', accepted_at: '2026-10-01T10:00:00Z', withdrawn_at: null },
    privacy: { version: '1.0', accepted_at: '2026-10-01T10:00:00Z', withdrawn_at: null },
    sensitive_data: null,
  },
};

const DOC = {
  document: 'privacy',
  lang: 'ro',
  version: '1.0',
  effective_date: '2026-08-23',
  title: 'Politica de confidențialitate',
  content: '# Politica de confidențialitate\n\n## 1. Operator\n\n- **Nume:** [de completat]',
  missing_placeholders: ['operator_name'],
};

function mockServer(me: Record<string, unknown>, faceVerification = false) {
  // Ca serverul real: după `POST /legal/consent`, `/auth/me` nu mai cere acord.
  let consented = false;
  const get = vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/auth/me') {
      return {
        data: consented && 'consent_required' in me ? { ...me, consent_required: false } : me,
      } as never;
    }
    if (url === '/legal/consent-status') return { data: PENDING } as never;
    if (url === CAPABILITIES_PATH) return { data: { face_verification: faceVerification } } as never;
    if (url.startsWith('/legal/documents/')) return { data: DOC } as never;
    throw httpError(404);
  });
  const post = vi.spyOn(api, 'post').mockImplementation(async (url: string) => {
    if (url === '/legal/consent') {
      consented = true;
      return { data: ACCEPTED } as never;
    }
    throw httpError(404);
  });
  return { get, post };
}

const ME = { id: 'u1', email: 'a@b.c', profile_completed: false };

beforeEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ status: 'idle', user: null, error: null, optimisticName: null });
});

describe('poarta de consimțământ', () => {
  it('apare când serverul cere consimțământ, înaintea înregistrării', async () => {
    mockServer({ ...ME, consent_required: true });
    renderRouted(<AppRoutes />);

    expect(await screen.findByTestId('consent-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('welcome-cta')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('apare și pentru un profil complet (versiune nouă), fără bara de taburi', async () => {
    mockServer({ ...ME, profile_completed: true, consent_required: true });
    renderRouted(<AppRoutes />, ['/feed']);

    expect(await screen.findByTestId('consent-screen')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it.each([
    ['false', { ...ME, consent_required: false }],
    ['absent (server vechi)', ME],
  ])('NU apare când consent_required e %s', async (_label, me) => {
    mockServer(me);
    renderRouted(<AppRoutes />);

    expect(await screen.findByTestId('welcome-cta')).toBeInTheDocument();
    expect(screen.queryByTestId('consent-screen')).not.toBeInTheDocument();
  });

  it('„Continuă" e inactiv până sunt bifate AMBELE căsuțe obligatorii', async () => {
    mockServer({ ...ME, consent_required: true });
    renderRouted(<AppRoutes />);

    const button = await screen.findByTestId('consent-continue');
    const terms = screen.getByTestId('consent-terms');
    const privacy = screen.getByTestId('consent-privacy');
    expect(terms).not.toBeChecked();
    expect(privacy).not.toBeChecked();
    expect(button).toBeDisabled();

    await userEvent.click(terms);
    expect(button).toBeDisabled();
    await userEvent.click(privacy);
    expect(button).toBeEnabled();
    await userEvent.click(terms);
    expect(button).toBeDisabled();
  });

  it('trimite documentele obligatorii cu versiunile în vigoare, apoi deschide aplicația', async () => {
    const { post } = mockServer({ ...ME, consent_required: true });
    renderRouted(<AppRoutes />);

    await userEvent.click(await screen.findByTestId('consent-terms'));
    await userEvent.click(screen.getByTestId('consent-privacy'));
    await userEvent.click(screen.getByTestId('consent-continue'));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/legal/consent', {
        documents: ['terms', 'privacy'],
        versions: { terms: '1.0', privacy: '1.0' },
      }),
    );
    // Bifa opțională nu există când verificarea facială e oprită pe server.
    expect(screen.queryByTestId('consent-sensitive')).not.toBeInTheDocument();
    // După acord, poarta se deschide: urmează înregistrarea.
    expect(await screen.findByTestId('welcome-cta')).toBeInTheDocument();
  });

  it('include consimțământul opțional pentru selfie doar dacă e bifat', async () => {
    const { post } = mockServer({ ...ME, consent_required: true }, true);
    renderRouted(<AppRoutes />);

    const sensitive = await screen.findByTestId('consent-sensitive');
    expect(sensitive).not.toBeChecked();
    await userEvent.click(screen.getByTestId('consent-terms'));
    await userEvent.click(screen.getByTestId('consent-privacy'));
    // Opționalul NU condiționează butonul.
    expect(screen.getByTestId('consent-continue')).toBeEnabled();
    await userEvent.click(sensitive);
    await userEvent.click(screen.getByTestId('consent-continue'));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/legal/consent', {
        documents: ['terms', 'privacy', 'sensitive_data'],
        versions: { terms: '1.0', privacy: '1.0', sensitive_data: '1.0' },
      }),
    );
  });

  it('o eroare la salvare rămâne pe poartă, cu mesaj', async () => {
    const { post } = mockServer({ ...ME, consent_required: true });
    post.mockRejectedValue(httpError(500));
    renderRouted(<AppRoutes />);

    await userEvent.click(await screen.findByTestId('consent-terms'));
    await userEvent.click(screen.getByTestId('consent-privacy'));
    await userEvent.click(screen.getByTestId('consent-continue'));

    expect(await screen.findByTestId('consent-error')).toBeInTheDocument();
    expect(screen.getByTestId('consent-screen')).toBeInTheDocument();
  });

  it('o versiune nouă apărută între timp (409) cere o nouă confirmare', async () => {
    const { post } = mockServer({ ...ME, consent_required: true });
    post.mockRejectedValue(httpError(409, 'stale'));
    renderRouted(<AppRoutes />);

    await userEvent.click(await screen.findByTestId('consent-terms'));
    await userEvent.click(screen.getByTestId('consent-privacy'));
    await userEvent.click(screen.getByTestId('consent-continue'));

    expect(await screen.findByTestId('consent-stale')).toBeInTheDocument();
    expect(screen.getByTestId('consent-terms')).not.toBeChecked();
    expect(screen.getByTestId('consent-continue')).toBeDisabled();
  });

  it('Politica se citește în poartă, cu versiunea, fără bara de taburi', async () => {
    const { get } = mockServer({ ...ME, consent_required: true });
    renderRouted(<AppRoutes />);

    await userEvent.click(await screen.findByTestId('consent-open-privacy'));

    expect(await screen.findByTestId('legal-doc-privacy')).toBeInTheDocument();
    expect(screen.getByTestId('legal-doc-meta')).toHaveTextContent('Versiunea 1.0');
    expect(screen.getByRole('heading', { name: '1. Operator' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/legal/documents/privacy', { params: { lang: 'ro' } });

    await userEvent.click(screen.getByTestId('deep-back'));
    expect(await screen.findByTestId('consent-screen')).toBeInTheDocument();
  });
});
