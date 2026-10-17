import { describe, expect, it } from 'vitest';

import {
  initialEntriesForStartPath,
  initialPathFromStartParam,
  normalizeUuid,
} from '../startParamRoute';

const UUID = '3f2b8c1e-9d4a-4e6b-8a1f-0c2d3e4f5a6b';

describe('initialPathFromStartParam', () => {
  it('duce butoanele botului la ecranele lor', () => {
    expect(initialPathFromStartParam('events')).toBe('/events');
    expect(initialPathFromStartParam('tickets')).toBe('/tickets');
    expect(initialPathFromStartParam('privacy')).toBe('/legal');
  });

  it('lasă pornirea neschimbată pentru parametri necunoscuți sau lipsă', () => {
    expect(initialPathFromStartParam(null)).toBe('/');
    expect(initialPathFromStartParam('')).toBe('/');
    expect(initialPathFromStartParam('INVITE-ABCD2345')).toBe('/');
  });

  describe('notificările botului', () => {
    it('`chat_<uuid>` deschide conversația', () => {
      expect(initialPathFromStartParam(`chat_${UUID}`)).toBe(`/mesaje/${UUID}`);
    });

    it('`stories_<uuid>` deschide feedul cu poveștile autorului', () => {
      expect(initialPathFromStartParam(`stories_${UUID}`)).toBe(`/feed?story=${UUID}`);
    });

    it('`likes` și `feed` duc în feed (rădăcina)', () => {
      expect(initialPathFromStartParam('likes')).toBe('/');
      expect(initialPathFromStartParam('feed')).toBe('/');
      expect(initialPathFromStartParam(' FEED ')).toBe('/');
    });

    it('normalizează UUID-ul: majuscule și forma compactă', () => {
      expect(initialPathFromStartParam(`chat_${UUID.toUpperCase()}`)).toBe(`/mesaje/${UUID}`);
      expect(initialPathFromStartParam(`CHAT_${UUID.replace(/-/g, '')}`)).toBe(`/mesaje/${UUID}`);
    });

    it.each([
      'chat_',
      'chat_123',
      'chat_not-a-uuid',
      `chat_${UUID}x`,
      `chat_${UUID.slice(0, 35)}`,
      `chat_3f2b8c1e9d4a-4e6b-8a1f-0c2d3e4f5a6b`,
      `chat_${UUID.replace(/-/g, '_')}`,
      `chat_../../${UUID}`,
      `chat__${UUID}`,
      `stories_zzzzzzzz-9d4a-4e6b-8a1f-0c2d3e4f5a6b`,
      `stories_${UUID}_extra`,
      `likes_${UUID}`,
      `profile_${UUID}`,
      'chat',
      'stories',
      `_${UUID}`,
    ])('ignoră parametrul malformat „%s"', (param) => {
      expect(initialPathFromStartParam(param)).toBe('/');
    });
  });
});

describe('normalizeUuid', () => {
  it('acceptă forma canonică și pe cea compactă', () => {
    expect(normalizeUuid(UUID)).toBe(UUID);
    expect(normalizeUuid(UUID.replace(/-/g, ''))).toBe(UUID);
  });

  it('respinge restul', () => {
    expect(normalizeUuid('')).toBeNull();
    expect(normalizeUuid(`${UUID}0`)).toBeNull();
    expect(normalizeUuid('3f2b8c1e-9d4a4e6b-8a1f-0c2d3e4f5a6b')).toBeNull();
  });
});

describe('initialEntriesForStartPath (istoricul de dedesubt)', () => {
  it('rădăcina și feedul NU primesc încă o intrare dedesubt', () => {
    expect(initialEntriesForStartPath('/')).toEqual(['/']);
    expect(initialEntriesForStartPath('/feed')).toEqual(['/feed']);
    expect(initialEntriesForStartPath(`/feed?story=${UUID}`)).toEqual([`/feed?story=${UUID}`]);
  });

  it('un ecran în adâncime primește `/` dedesubt, ca ÎNAPOI să aibă unde duce', () => {
    expect(initialEntriesForStartPath('/tickets')).toEqual(['/', '/tickets']);
    expect(initialEntriesForStartPath(`/mesaje/${UUID}`)).toEqual(['/', `/mesaje/${UUID}`]);
  });

  it('lanțul complet: notificarea de mesaj → conversația, cu feedul dedesubt', () => {
    const entries = initialEntriesForStartPath(initialPathFromStartParam(`chat_${UUID}`));
    expect(entries).toEqual(['/', `/mesaje/${UUID}`]);
    const feedEntries = initialEntriesForStartPath(initialPathFromStartParam('feed'));
    expect(feedEntries).toEqual(['/']);
  });
});
