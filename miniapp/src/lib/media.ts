/**
 * URL-uri pentru variantele WebP ale pozelor (generate de backend la upload,
 * `backend/app/services/image_variants.py`).
 *
 * Convenția de chei e FIXĂ și oglindește `variant_key` din backend:
 *   `photos/<profil>/<32 hex>.jpg` → `photos/<profil>/<32 hex>_256.webp`
 *
 * Prefixele reale ale cheilor din storage: `photos/`, `stories/`,
 * `chat-media/`, `events/` (`chat/` e acceptat pentru compatibilitate).
 * Orice alt URL (Telegram, data:, blob:, nume de fișier ne-generate de server)
 * rămâne neschimbat. Pozele vechi, fără variante, sunt acoperite de fallback-ul
 * din `<Photo>` (la eroare trece pe URL-ul original).
 */

export type VariantSize = 256 | 480 | 800;

const MEDIA_PATH_RE =
  /(?:^|\/)(?:photos|stories|chat-media|chat|events)\/(?:[^/]+\/)*[0-9a-f]{32}\.(?:jpe?g|png|webp)$/i;
const FILE_RE = /([0-9a-f]{32})\.(?:jpe?g|png|webp)$/i;
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;
const HOST_RE = /^(?:[a-z][a-z0-9+.-]*:)?\/\/([^/]+)/i;

function isExternalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, '').replace(/^.*@/, '');
  return h === 't.me' || h.endsWith('.t.me') || h.includes('telegram');
}

export function variantUrl(
  url: string | null | undefined,
  size: VariantSize,
): string | null | undefined {
  if (!url) return url;

  const scheme = SCHEME_RE.exec(url)?.[1]?.toLowerCase();
  if (scheme && scheme !== 'http' && scheme !== 'https') return url; // data:, blob:, tg: ...

  const cut = url.search(/[?#]/);
  const path = cut === -1 ? url : url.slice(0, cut);
  const suffix = cut === -1 ? '' : url.slice(cut);

  const host = HOST_RE.exec(path)?.[1];
  if (host && isExternalHost(host)) return url;
  if (!MEDIA_PATH_RE.test(path)) return url;

  return path.replace(FILE_RE, `$1_${size}.webp`) + suffix;
}
