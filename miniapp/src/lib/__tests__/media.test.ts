import { describe, expect, it } from 'vitest';

import { variantUrl } from '@/lib/media';

const HEX = '0123456789abcdef0123456789abcdef';
const PROFILE = '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f';

describe('variantUrl', () => {
  it.each([
    [
      `https://api.flrt.md/media/photos/${PROFILE}/${HEX}.jpg`,
      256,
      `https://api.flrt.md/media/photos/${PROFILE}/${HEX}_256.webp`,
    ],
    [
      `https://flirt.s3.eu-central-1.amazonaws.com/photos/${PROFILE}/${HEX}.jpeg`,
      800,
      `https://flirt.s3.eu-central-1.amazonaws.com/photos/${PROFILE}/${HEX}_800.webp`,
    ],
    [`/media/stories/u1/${HEX}.png`, 480, `/media/stories/u1/${HEX}_480.webp`],
    [`/media/chat-media/c1/${HEX}.webp`, 256, `/media/chat-media/c1/${HEX}_256.webp`],
    [`/media/events/${HEX}.JPG`, 800, `/media/events/${HEX}_800.webp`],
    [`/photos/u1/${HEX}.jpg`, 256, `/photos/u1/${HEX}_256.webp`],
    [`photos/u1/${HEX}.jpg`, 256, `photos/u1/${HEX}_256.webp`],
  ] as const)('%s → %s', (url, size, expected) => {
    expect(variantUrl(url as string, size as 256 | 480 | 800)).toBe(expected);
  });

  it('păstrează query-ul și hash-ul', () => {
    expect(variantUrl(`https://api.flrt.md/media/photos/u/${HEX}.jpg?v=3&x=y#a`, 256)).toBe(
      `https://api.flrt.md/media/photos/u/${HEX}_256.webp?v=3&x=y#a`,
    );
    expect(variantUrl(`/media/events/${HEX}.png?t=1`, 800)).toBe(
      `/media/events/${HEX}_800.webp?t=1`,
    );
  });

  it.each([
    null,
    undefined,
    '',
  ])('întoarce neschimbat %s', (value) => {
    expect(variantUrl(value, 256)).toBe(value);
  });

  it.each([
    // Telegram / externe
    `https://t.me/i/userpic/320/${HEX}.jpg`,
    `https://cdn4.telegram-cdn.org/file/photos/${HEX}.jpg`,
    `https://api.telegram.org/file/bot1/photos/${HEX}.jpg`,
    // data: / blob:
    `data:image/jpeg;base64,/photos/${HEX}.jpg`,
    `blob:https://miniapp.flrt.md/photos/${HEX}.jpg`,
    // nu e sub un prefix de media
    `https://api.flrt.md/media/ads/${HEX}.jpg`,
    `https://api.flrt.md/media/${HEX}.jpg`,
    // numele nu e 32 hex / e deja variantă / nu e imagine
    'https://api.flrt.md/media/photos/u/poza.jpg',
    `https://api.flrt.md/media/photos/u/${HEX}_256.webp`,
    `https://api.flrt.md/media/stories/u/${HEX}.mp4`,
    `https://api.flrt.md/media/photos/u/${HEX}0.jpg`,
    // prefixul doar în query, nu în path
    `https://example.com/img.jpg?next=/photos/u/${HEX}.jpg`,
  ])('nu transformă %s', (url) => {
    expect(variantUrl(url, 256)).toBe(url);
  });
});
