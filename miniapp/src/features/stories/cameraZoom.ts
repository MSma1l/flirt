/**
 * Zoom-ul camerei de story — matematica pură (testabilă fără cameră).
 *
 * DOUĂ MODURI:
 *   - `hardware`: camera expune `zoom` în `MediaStreamTrack.getCapabilities()`
 *     (Chrome pe Android, unele WebView-uri) → `applyConstraints({ advanced:
 *     [{ zoom }] })`; cadrele vin deja mărite, captura rămâne cadrul întreg;
 *   - `digital`: fără suport (iOS, desktop) → previzualizarea se mărește prin
 *     CSS (`scale` față de centru), iar la captură se decupează EXACT aceeași
 *     regiune centrală din cadru, ca poza să fie ce s-a văzut pe ecran.
 */

export type ZoomMode = 'hardware' | 'digital';

export interface ZoomRange {
  mode: ZoomMode;
  min: number;
  max: number;
  step: number;
}

/** Plafonul zoom-ului digital: peste 4× poza devine prea pixelată. */
export const DIGITAL_MAX_ZOOM = 4;

/** Treptele rapide (butoanele 1× / 2× / …), filtrate după ce suportă camera. */
const PRESETS = [1, 2, 3];

export const DIGITAL_RANGE: ZoomRange = { mode: 'digital', min: 1, max: DIGITAL_MAX_ZOOM, step: 0.01 };

/** `value` adus în [min, max]; NaN / infinit → min. */
export function clampZoom(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Zoom-ul rotunjit la `step`-ul camerei (camera refuză valori intermediare). */
export function snapZoom(value: number, range: ZoomRange): number {
  const step = range.step > 0 ? range.step : 0.01;
  const snapped = range.min + Math.round((value - range.min) / step) * step;
  // Rotunjim la 2 zecimale ca să nu ducem erori de virgulă mobilă (1.2000000001).
  return clampZoom(Math.round(snapped * 100) / 100, range.min, range.max);
}

interface ZoomCapabilityLike {
  min?: number;
  max?: number;
  step?: number;
}

/**
 * Intervalul de zoom HARDWARE al pistei video, sau `null` dacă lipsește ori e
 * inutil (max ≤ 1). Orice excepție (API parțial) → `null` → zoom digital.
 */
export function hardwareZoomRange(track: MediaStreamTrack | undefined | null): ZoomRange | null {
  try {
    const caps = track?.getCapabilities?.() as { zoom?: ZoomCapabilityLike } | undefined;
    const zoom = caps?.zoom;
    if (!zoom || typeof zoom.max !== 'number' || typeof zoom.min !== 'number') return null;
    if (!(zoom.max > zoom.min) || zoom.max <= 1) return null;
    return {
      mode: 'hardware',
      min: zoom.min,
      max: zoom.max,
      step: typeof zoom.step === 'number' && zoom.step > 0 ? zoom.step : 0.1,
    };
  } catch {
    return null;
  }
}

/** Zoom-ul de pornire: 1× dacă intră în interval, altfel cea mai apropiată limită. */
export function initialZoom(range: ZoomRange): number {
  return clampZoom(1, range.min, range.max);
}

/** Treptele afișate ca butoane (doar cele din interval; cel puțin 1×). */
export function zoomPresets(range: ZoomRange): number[] {
  const inRange = PRESETS.filter((p) => p >= range.min - 1e-6 && p <= range.max + 1e-6);
  return inRange.length > 0 ? inRange : [initialZoom(range)];
}

/** Distanța dintre două atingeri (pinch). */
export function touchDistance(
  a: { clientX: number; clientY: number },
  b: { clientX: number; clientY: number },
): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/**
 * Zoom-ul în timpul unui pinch: proporțional cu cât s-au depărtat degetele
 * față de începutul gestului (`startDistance` → `distance`), în interval.
 */
export function pinchZoom(
  startZoom: number,
  startDistance: number,
  distance: number,
  range: ZoomRange,
): number {
  if (!(startDistance > 0) || !(distance > 0)) return clampZoom(startZoom, range.min, range.max);
  return clampZoom(startZoom * (distance / startDistance), range.min, range.max);
}

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Regiunea CENTRALĂ a cadrului vizibilă la zoom digital `zoom` (1/zoom din
 * fiecare latură). Pentru `zoom ≤ 1` → cadrul întreg. Valori întregi, ca
 * `drawImage` să nu interpoleze margini pe jumătate de pixel.
 *
 * Previzualizarea e `object-fit: cover` + `scale(zoom)` față de centrul
 * elementului, care coincide cu centrul cadrului → decupajul central păstrează
 * exact încadrarea văzută. Oglindirea (camera frontală, doar CSS) nu schimbă
 * nimic: decupajul e simetric față de centru.
 */
export function digitalCropRect(width: number, height: number, zoom: number): CropRect {
  const z = Number.isFinite(zoom) && zoom > 1 ? zoom : 1;
  const sw = Math.max(1, Math.round(width / z));
  const sh = Math.max(1, Math.round(height / z));
  return {
    sx: Math.round((width - sw) / 2),
    sy: Math.round((height - sh) / 2),
    sw,
    sh,
  };
}

/** Transformarea CSS a previzualizării: zoom digital + oglindire (camera frontală). */
export function previewTransform(zoom: number, mirrored: boolean, mode: ZoomMode): string | undefined {
  const scale = mode === 'digital' && zoom > 1 ? zoom : 1;
  if (scale === 1) return mirrored ? 'scaleX(-1)' : undefined;
  return mirrored ? `scale(${-scale}, ${scale})` : `scale(${scale})`;
}

/** Eticheta zoom-ului: „1", „1.5", „2" (fără zerouri inutile). */
export function formatZoom(zoom: number): string {
  const rounded = Math.round(zoom * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
