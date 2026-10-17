import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { FetchMock } from '../test/harness';

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
    // Varianta secundară, manuală: „sau lipește un URL" (prima din formular = video).
    await person.click(within(dialog).getAllByText('sau lipește un URL')[0]!);
    await person.type(within(dialog).getByLabelText('URL video'), 'https://cdn.example.com/ad.mp4');
    expect(within(dialog).getByTestId('ad-video-preview')).toHaveAttribute(
      'src',
      'https://cdn.example.com/ad.mp4',
    );
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

  describe('încărcarea media de pe dispozitiv', () => {
    const IMAGE_URL = 'https://api.example.com/media/ads/abc.jpg';
    const VIDEO_URL = 'https://api.example.com/media/ads/abc.mp4';

    /** Apelurile `fetch` reale către ruta de upload (corpul e FormData, nu JSON). */
    function mediaUploads(api: FetchMock): FormData[] {
      return api.fetch.mock.calls
        .filter(([input]) => String(input).includes('/admin/ads/media'))
        .map(([, init]) => (init as RequestInit).body as FormData);
    }

    async function openNewAdForm(routes: Parameters<typeof mockFetch>[0] = {}) {
      seedAdminSession();
      const api = mockFetch({
        'GET /admin/ads/settings': { body: SETTINGS },
        'GET /admin/ads': { body: [] },
        'POST /admin/ads': { body: AD },
        ...routes,
      });
      // `applyAccept: false`: lăsăm fișierul „greșit" să ajungă la validarea noastră.
      const person = userEvent.setup({ applyAccept: false });
      renderWithProviders(<AdsPage />);
      await screen.findByText('Nicio reclamă');
      await person.click(screen.getByRole('button', { name: 'Reclamă nouă' }));
      const dialog = await screen.findByRole('dialog');
      await person.type(within(dialog).getByLabelText('Titlu *'), 'Reclamă foto');
      return { api, person, dialog };
    }

    it('încarcă o imagine: FormData spre /admin/ads/media, completează image_url și arată previzualizarea', async () => {
      const { api, person, dialog } = await openNewAdForm({
        'POST /admin/ads/media': { body: { url: IMAGE_URL, media_type: 'image' } },
      });
      const file = new File(['jpg-bytes'], 'poza.jpg', { type: 'image/jpeg' });

      await person.upload(within(dialog).getByLabelText('Încarcă imagine de pe dispozitiv'), file);

      expect(await within(dialog).findByTestId('ad-image-preview')).toHaveAttribute('src', IMAGE_URL);
      const uploads = mediaUploads(api);
      expect(uploads).toHaveLength(1);
      expect(uploads[0]).toBeInstanceOf(FormData);
      expect((uploads[0]!.get('file') as File).name).toBe('poza.jpg');
      expect(within(dialog).getByLabelText('URL imagine')).toHaveValue(IMAGE_URL);

      await person.click(within(dialog).getByRole('button', { name: 'Creează reclama' }));
      await waitFor(() => {
        expect(api.callsTo('POST /admin/ads')).toHaveLength(1);
      });
      expect(api.callsTo('POST /admin/ads')[0]?.body).toMatchObject({
        image_url: IMAGE_URL,
        video_url: null,
      });
    });

    it('încarcă un video, îl previzualizează și „Șterge" golește câmpul', async () => {
      const { api, person, dialog } = await openNewAdForm({
        'POST /admin/ads/media': { body: { url: VIDEO_URL, media_type: 'video' } },
      });
      const file = new File(['mp4-bytes'], 'clip.mov', { type: 'video/quicktime' });

      await person.upload(within(dialog).getByLabelText('Încarcă video de pe dispozitiv'), file);

      const preview = await within(dialog).findByTestId('ad-video-preview');
      expect(preview).toHaveAttribute('src', VIDEO_URL);
      expect(preview).toHaveAttribute('controls');
      expect((mediaUploads(api)[0]!.get('file') as File).name).toBe('clip.mov');
      expect(within(dialog).getByLabelText('URL video')).toHaveValue(VIDEO_URL);

      await person.click(within(dialog).getByRole('button', { name: 'Șterge videoul' }));
      expect(within(dialog).queryByTestId('ad-video-preview')).not.toBeInTheDocument();
      expect(within(dialog).getByLabelText('URL video')).toHaveValue('');
      expect(within(dialog).getByRole('button', { name: 'Creează reclama' })).toBeDisabled();
    });

    it('413 de la server → mesajul de mărime, câmpul rămâne gol', async () => {
      const { api, person, dialog } = await openNewAdForm({
        'POST /admin/ads/media': {
          status: 413,
          body: { detail: 'File too large', code: 'file_too_large' },
        },
      });
      const file = new File(['big'], 'mare.mp4', { type: 'video/mp4' });

      await person.upload(within(dialog).getByLabelText('Încarcă video de pe dispozitiv'), file);

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'Videoul e prea mare — maximum 50 MB.',
      );
      expect(mediaUploads(api)).toHaveLength(1);
      expect(within(dialog).queryByTestId('ad-video-preview')).not.toBeInTheDocument();
    });

    it('tipul greșit e refuzat local, fără cerere', async () => {
      const { api, person, dialog } = await openNewAdForm();

      await person.upload(
        within(dialog).getByLabelText('Încarcă imagine de pe dispozitiv'),
        new File(['gif'], 'anim.gif', { type: 'image/gif' }),
      );
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        'Acceptăm doar imagini JPG, PNG sau WEBP.',
      );

      // Un video prea mare e refuzat tot local (limita de 50 MB).
      const huge = new File(['x'], 'mare.mp4', { type: 'video/mp4' });
      Object.defineProperty(huge, 'size', { value: 51 * 1024 * 1024 });
      await person.upload(within(dialog).getByLabelText('Încarcă video de pe dispozitiv'), huge);
      expect(within(dialog).getByText('Videoul e prea mare — maximum 50 MB.')).toBeInTheDocument();

      expect(mediaUploads(api)).toHaveLength(0);
    });

    it('salvarea e blocată cât timp fișierul urcă', async () => {
      const { api, person, dialog } = await openNewAdForm();
      // Un URL manual face formularul valid; upload-ul în curs trebuie totuși să blocheze.
      await person.click(within(dialog).getAllByText('sau lipește un URL')[0]!);
      await person.type(within(dialog).getByLabelText('URL video'), 'https://cdn.example.com/a.mp4');
      const save = within(dialog).getByRole('button', { name: 'Creează reclama' });
      expect(save).toBeEnabled();

      let finish: (response: Response) => void = () => undefined;
      api.fetch.mockImplementationOnce(
        () => new Promise<Response>((resolve) => {
          finish = resolve;
        }),
      );
      await person.upload(
        within(dialog).getByLabelText('Încarcă imagine de pe dispozitiv'),
        new File(['png'], 'poza.png', { type: 'image/png' }),
      );

      expect(await within(dialog).findByText('Se încarcă imaginea…')).toBeInTheDocument();
      expect(save).toBeDisabled();

      finish(
        new Response(JSON.stringify({ url: IMAGE_URL, media_type: 'image' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      expect(await within(dialog).findByTestId('ad-image-preview')).toHaveAttribute('src', IMAGE_URL);
      expect(save).toBeEnabled();
    });
  });
});
