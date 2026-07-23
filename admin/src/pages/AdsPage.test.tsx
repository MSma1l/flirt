import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { AdsPage } from './AdsPage';
import type { Ad, AdSettings } from '../api/types';
import { mockFetch, renderWithProviders, seedAdminSession } from '../test/harness';

const SETTINGS: AdSettings = {
  swipes_before_ad: 8,
  max_video_seconds: 30,
  enabled: true,
};

const AD: Ad = {
  id: 1,
  title: 'Reclamă Coca-Cola',
  video_url: 'https://cdn.example.com/ad.mp4',
  image_url: null,
  duration_seconds: 15,
  active: true,
  weight: 2,
  target_gender: null,
  target_age_min: null,
  target_age_max: null,
  starts_at: null,
  ends_at: null,
  impressions: 1200,
  clicks: 36,
  created_at: '2026-07-01T10:00:00Z',
  updated_at: '2026-07-01T10:00:00Z',
};

describe('AdsPage', () => {
  it('creează o reclamă nouă cu payload-ul corect', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/ads/settings': { body: SETTINGS },
      'GET /admin/ads': { body: [] },
      'POST /admin/ads': { body: AD },
    });
    const person = userEvent.setup();

    renderWithProviders(<AdsPage />);
    await screen.findByText('Nicio reclamă');

    await person.click(screen.getByRole('button', { name: 'Reclamă nouă' }));
    const dialog = await screen.findByRole('dialog');

    await person.type(within(dialog).getByLabelText('Titlu *'), 'Reclamă Coca-Cola');
    await person.type(within(dialog).getByLabelText('URL video'), 'https://cdn.example.com/ad.mp4');
    await person.click(within(dialog).getByRole('button', { name: 'Creează reclama' }));

    await waitFor(() => {
      expect(api.callsTo('POST /admin/ads')).toHaveLength(1);
    });
    expect(api.callsTo('POST /admin/ads')[0]?.body).toMatchObject({
      title: 'Reclamă Coca-Cola',
      video_url: 'https://cdn.example.com/ad.mp4',
      duration_seconds: 15,
      active: true,
    });
  });

  it('salvează setările globale prin PUT', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/ads/settings': { body: SETTINGS },
      'GET /admin/ads': { body: [AD] },
      'PUT /admin/ads/settings': { body: { ...SETTINGS, swipes_before_ad: 5 } },
    });
    const person = userEvent.setup();

    renderWithProviders(<AdsPage />);
    const swipes = await screen.findByLabelText('Swipe-uri până la reclamă *');

    await person.clear(swipes);
    await person.type(swipes, '5');
    await person.click(screen.getByRole('button', { name: 'Salvează setările' }));

    await waitFor(() => {
      expect(api.callsTo('PUT /admin/ads/settings')).toHaveLength(1);
    });
    expect(api.callsTo('PUT /admin/ads/settings')[0]?.body).toMatchObject({
      swipes_before_ad: 5,
      max_video_seconds: 30,
      enabled: true,
    });
  });

  it('nu șterge o reclamă fără confirmare', async () => {
    seedAdminSession();
    const api = mockFetch({
      'GET /admin/ads/settings': { body: SETTINGS },
      'GET /admin/ads': { body: [AD] },
      'DELETE /admin/ads/1': { status: 204 },
    });
    const person = userEvent.setup();

    renderWithProviders(<AdsPage />);
    await screen.findByText('Reclamă Coca-Cola');

    await person.click(screen.getByRole('button', { name: 'Șterge' }));
    const dialog = await screen.findByRole('dialog');
    expect(api.callsTo('DELETE /admin/ads/1')).toHaveLength(0);

    await person.click(within(dialog).getByRole('button', { name: 'Șterge reclama' }));
    await waitFor(() => {
      expect(api.callsTo('DELETE /admin/ads/1')).toHaveLength(1);
    });
  });
});
