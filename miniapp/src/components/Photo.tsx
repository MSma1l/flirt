import { useState, type ComponentProps, type SyntheticEvent } from 'react';

import { variantUrl, type VariantSize } from '@/lib/media';

export type PhotoProps = Omit<ComponentProps<'img'>, 'src' | 'loading' | 'fetchPriority'> & {
  /** URL-ul ORIGINAL al pozei (cel salvat în profil / mesaj / poveste). */
  src: string | null | undefined;
  /** Varianta WebP dorită (latura mare, px). Fără `size` → originalul. */
  size?: VariantSize;
  /** Poza vizibilă imediat (ex. primul card din feed): eager + prioritate mare. */
  priority?: boolean;
};

/**
 * `<img>` pentru pozele din storage: cere varianta WebP mică potrivită și,
 * dacă ea lipsește (poze vechi, încărcate înainte de variante), trece O
 * SINGURĂ DATĂ pe URL-ul original; abia apoi cheamă `onError`-ul primit.
 */
export function Photo({
  src,
  size,
  priority = false,
  alt = '',
  onError,
  ...imgProps
}: PhotoProps) {
  const original = src ?? undefined;
  const preferred = (size ? variantUrl(src, size) : src) ?? undefined;
  // Ținem minte PENTRU CE URL am căzut pe original — la schimbarea `src`/`size`
  // fallback-ul se resetează singur, fără efect.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const usingOriginal = failedUrl !== null && failedUrl === preferred;
  const current = usingOriginal ? original : preferred;

  const handleError = (event: SyntheticEvent<HTMLImageElement, Event>) => {
    if (!usingOriginal && preferred && original && preferred !== original) {
      setFailedUrl(preferred);
      return;
    }
    onError?.(event);
  };

  return (
    <img
      {...imgProps}
      src={current}
      alt={alt}
      decoding="async"
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      onError={handleError}
    />
  );
}

export default Photo;
