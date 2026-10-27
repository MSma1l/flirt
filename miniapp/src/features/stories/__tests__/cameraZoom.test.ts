import { describe, expect, it } from 'vitest';

import {
  DIGITAL_MAX_ZOOM,
  DIGITAL_RANGE,
  clampZoom,
  digitalCropRect,
  formatZoom,
  hardwareZoomRange,
  initialZoom,
  pinchZoom,
  previewTransform,
  snapZoom,
  touchDistance,
  zoomPresets,
  type ZoomRange,
} from '../cameraZoom';

function track(caps: unknown): MediaStreamTrack {
  return { getCapabilities: () => caps } as unknown as MediaStreamTrack;
}

const HW: ZoomRange = { mode: 'hardware', min: 1, max: 8, step: 0.1 };

describe('cameraZoom', () => {
  it('clampZoom ține valoarea în interval; NaN → min', () => {
    expect(clampZoom(0.5, 1, 4)).toBe(1);
    expect(clampZoom(9, 1, 4)).toBe(4);
    expect(clampZoom(2.5, 1, 4)).toBe(2.5);
    expect(clampZoom(Number.NaN, 1, 4)).toBe(1);
  });

  it('snapZoom rotunjește la pasul camerei, fără erori de virgulă mobilă', () => {
    expect(snapZoom(1.234, HW)).toBe(1.2);
    expect(snapZoom(1.26, HW)).toBe(1.3);
    expect(snapZoom(20, HW)).toBe(8);
    expect(snapZoom(1.5, { mode: 'hardware', min: 1, max: 5, step: 0.5 })).toBe(1.5);
    expect(snapZoom(1.74, { mode: 'hardware', min: 1, max: 5, step: 0.5 })).toBe(1.5);
    expect(snapZoom(2.346, DIGITAL_RANGE)).toBe(2.35);
  });

  describe('hardwareZoomRange', () => {
    it('citește min/max/step din getCapabilities().zoom', () => {
      expect(hardwareZoomRange(track({ zoom: { min: 1, max: 10, step: 0.1 } }))).toEqual({
        mode: 'hardware',
        min: 1,
        max: 10,
        step: 0.1,
      });
    });

    it('fără zoom, cu interval inutil sau cu API lipsă/aruncând → null (zoom digital)', () => {
      expect(hardwareZoomRange(track({}))).toBeNull();
      expect(hardwareZoomRange(track({ zoom: { min: 1, max: 1 } }))).toBeNull();
      expect(hardwareZoomRange(track({ zoom: { min: 0.5, max: 1 } }))).toBeNull();
      expect(hardwareZoomRange({} as MediaStreamTrack)).toBeNull();
      expect(hardwareZoomRange(null)).toBeNull();
      const throwing = {
        getCapabilities: () => {
          throw new Error('nope');
        },
      } as unknown as MediaStreamTrack;
      expect(hardwareZoomRange(throwing)).toBeNull();
    });

    it('pas lipsă → 0.1', () => {
      expect(hardwareZoomRange(track({ zoom: { min: 1, max: 4 } }))?.step).toBe(0.1);
    });
  });

  it('initialZoom: 1× dacă e în interval, altfel limita cea mai apropiată', () => {
    expect(initialZoom(HW)).toBe(1);
    expect(initialZoom({ mode: 'hardware', min: 2, max: 8, step: 1 })).toBe(2);
    expect(initialZoom({ mode: 'hardware', min: 0.5, max: 8, step: 0.1 })).toBe(1);
  });

  it('zoomPresets: doar treptele pe care le suportă camera', () => {
    expect(zoomPresets(HW)).toEqual([1, 2, 3]);
    expect(zoomPresets(DIGITAL_RANGE)).toEqual([1, 2, 3]);
    expect(zoomPresets({ mode: 'hardware', min: 1, max: 2.5, step: 0.1 })).toEqual([1, 2]);
    expect(zoomPresets({ mode: 'hardware', min: 1, max: 1.5, step: 0.1 })).toEqual([1]);
  });

  it('pinchZoom e proporțional cu depărtarea degetelor și rămâne în interval', () => {
    expect(touchDistance({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 })).toBe(5);
    expect(pinchZoom(1, 100, 200, DIGITAL_RANGE)).toBe(2);
    expect(pinchZoom(2, 100, 50, DIGITAL_RANGE)).toBe(1);
    expect(pinchZoom(2, 100, 10, DIGITAL_RANGE)).toBe(1);
    expect(pinchZoom(3, 100, 1000, DIGITAL_RANGE)).toBe(DIGITAL_MAX_ZOOM);
    // Distanță de start invalidă → zoom-ul de start, nu NaN.
    expect(pinchZoom(1.5, 0, 100, DIGITAL_RANGE)).toBe(1.5);
  });

  describe('digitalCropRect', () => {
    it('la 1× (sau mai puțin) e cadrul întreg', () => {
      expect(digitalCropRect(1280, 720, 1)).toEqual({ sx: 0, sy: 0, sw: 1280, sh: 720 });
      expect(digitalCropRect(1280, 720, 0.5)).toEqual({ sx: 0, sy: 0, sw: 1280, sh: 720 });
      expect(digitalCropRect(1280, 720, Number.NaN)).toEqual({ sx: 0, sy: 0, sw: 1280, sh: 720 });
    });

    it('la 2× e sfertul central (jumătate din fiecare latură)', () => {
      expect(digitalCropRect(1280, 720, 2)).toEqual({ sx: 320, sy: 180, sw: 640, sh: 360 });
    });

    it('decupajul e centrat și păstrează proporția cadrului', () => {
      const { sx, sy, sw, sh } = digitalCropRect(1920, 1080, 3);
      expect(sw).toBe(640);
      expect(sh).toBe(360);
      expect(sx * 2 + sw).toBe(1920);
      expect(sy * 2 + sh).toBe(1080);
      expect(sw / sh).toBeCloseTo(1920 / 1080, 2);
    });
  });

  it('previewTransform: zoom digital + oglindire; zoom hardware nu scalează CSS', () => {
    expect(previewTransform(1, false, 'digital')).toBeUndefined();
    expect(previewTransform(1, true, 'digital')).toBe('scaleX(-1)');
    expect(previewTransform(2, false, 'digital')).toBe('scale(2)');
    expect(previewTransform(2, true, 'digital')).toBe('scale(-2, 2)');
    expect(previewTransform(2, false, 'hardware')).toBeUndefined();
    expect(previewTransform(2, true, 'hardware')).toBe('scaleX(-1)');
  });

  it('formatZoom', () => {
    expect(formatZoom(1)).toBe('1');
    expect(formatZoom(2)).toBe('2');
    expect(formatZoom(1.63)).toBe('1.6');
    expect(formatZoom(1.97)).toBe('2');
  });
});
