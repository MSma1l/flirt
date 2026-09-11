/**
 * Logica pură din pregătirea pozelor: cât redimensionăm, ce tipuri acceptăm și
 * unde sunt pragurile backendului. Partea cu `canvas` e exercitată indirect în
 * testele ecranului (jsdom nu implementează `toBlob`).
 */
import { describe, expect, it } from 'vitest';

import {
  formatMb,
  PHOTO_LIMITS,
  resizeTarget,
  validateCanAddPhoto,
  validatePhotoCount,
  validateSourceType,
} from '../photoResize';

describe('resizeTarget', () => {
  it('nu mărește niciodată o poză deja mică', () => {
    expect(resizeTarget(800, 600)).toBeNull();
    expect(resizeTarget(1920, 1080)).toBeNull();
  });

  it('aduce latura mare la limită și păstrează proporția', () => {
    expect(resizeTarget(4000, 3000)).toEqual({ width: 1920, height: 1440 });
    expect(resizeTarget(3000, 4000)).toEqual({ width: 1440, height: 1920 });
  });

  it('tratează dimensiunile absurde ca „nimic de făcut"', () => {
    expect(resizeTarget(0, 0)).toBeNull();
  });
});

describe('limitele de poze', () => {
  it('refuză adăugarea peste maximul backendului', () => {
    expect(validateCanAddPhoto(PHOTO_LIMITS.max - 1)).toBeNull();
    expect(validateCanAddPhoto(PHOTO_LIMITS.max)).toContain(String(PHOTO_LIMITS.max));
  });

  it('cere numărul minim de poze', () => {
    expect(validatePhotoCount(PHOTO_LIMITS.min - 1)).toContain(String(PHOTO_LIMITS.min));
    expect(validatePhotoCount(PHOTO_LIMITS.min)).toBeNull();
    expect(validatePhotoCount(PHOTO_LIMITS.max + 1)).not.toBeNull();
  });

  it('acceptă tipurile backendului și HEIC (pe care îl reencodăm)', () => {
    expect(validateSourceType('image/jpeg')).toBeNull();
    expect(validateSourceType('image/heic')).toBeNull();
    // Tip lipsă: browserul nu îl raportează mereu — recompresia forțează JPEG.
    expect(validateSourceType('')).toBeNull();
    expect(validateSourceType(undefined)).toBeNull();
    expect(validateSourceType('application/pdf')).not.toBeNull();
  });
});

describe('formatMb', () => {
  it('taie zecimala inutilă', () => {
    expect(formatMb(8_388_608)).toBe('8 MB');
    expect(formatMb(1_572_864)).toBe('1.5 MB');
  });
});
