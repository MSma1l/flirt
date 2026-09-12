/**
 * Logoul FLIRT.
 *
 * Sursa e `mobile/assets/logo.png`, dar NU fișierul original: acela are 771 KB
 * și 1183px lățime, adică de zeci de ori mai mult decât are nevoie un logo
 * afișat la ~160px. Copia optimizată pentru web stă în `src/assets/logo.png`
 * (360px lățime, ~23 KB) și trece prin Vite, deci primește un nume cu amprentă
 * și poate fi memorată de browser la nesfârșit.
 *
 * E `import`, nu cale din `public/`, exact pentru amprentă: la o schimbare de
 * logo, adresa se schimbă singură și nimeni nu rămâne cu varianta veche în cache.
 */
import logoUrl from '@/assets/logo.png';

export interface BrandLogoProps {
  /** Lățimea afișată, în px. Implicit 160 — dimensiunea ecranelor de stare. */
  width?: number;
  className?: string;
}

export function BrandLogo({ width = 160, className }: BrandLogoProps) {
  return (
    <img
      className={className ? `brand-logo ${className}` : 'brand-logo'}
      src={logoUrl}
      // Logoul e decorativ lângă un titlu care spune deja totul; un `alt`
      // („FLIRT") l-ar face pe cititorul de ecran să anunțe numele de două ori.
      alt=""
      aria-hidden="true"
      width={width}
      // 360×224 = raportul imaginii sursă. Scris explicit ca browserul să
      // rezerve locul ÎNAINTE de descărcare și textul să nu sară.
      height={Math.round((width * 224) / 360)}
      draggable={false}
      data-testid="brand-logo"
    />
  );
}

export default BrandLogo;
