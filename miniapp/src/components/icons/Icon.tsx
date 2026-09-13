/**
 * Componenta care desenează o iconiță din set.
 *
 * Desenul e SVG INLINE, nu `<img>` și nu font de iconițe. Motivele:
 *  – `currentColor` funcționează doar în marcaj: așa tabul activ se colorează
 *    singur din CSS, fără o a doua variantă de fișier pentru starea activă;
 *  – nu există o a doua cerere de rețea, deci iconița e acolo din primul cadru,
 *    iar bara de taburi nu se „completează" după ce s-a desenat ecranul;
 *  – politica de securitate a paginii nu ar lăsa oricum un CDN de iconițe.
 *
 * DIMENSIUNEA NU E ÎN MARCAJ. `<svg>` nu primește `width`/`height`; le dă CSS-ul
 * (`.icon`), ca aceeași iconiță să fie 22px în bara de taburi și 21px în meniu
 * fără o a doua componentă. Regula de bază din `global.css` garantează o mărime
 * chiar și pentru o folosire nouă — un `<svg>` fără dimensiuni ar cădea altfel
 * pe 300×150, implicitul din specificație.
 *
 * ACCESIBILITATE: `aria-hidden`. Lângă fiecare iconiță stă deja eticheta text
 * („Mesaje", „Profil"), iar un cititor de ecran nu trebuie să anunțe de două ori
 * același lucru. `focusable="false"` oprește tabularea în SVG pe Edge vechi.
 */
import { ICON_PATHS, type IconName } from './paths';

export type { IconName };
export { ICON_PATHS };

/**
 * Grosimea liniei, aceeași pentru tot setul.
 *
 * `ACTIVE` e AL DOILEA SEMNAL al stării active, cel care nu depinde de culoare:
 * linia se îngroașă vizibil. Rămâne și ca atribut în DOM, nu doar în CSS, ca
 * semnalul să fie verificabil într-un test și să existe chiar dacă foaia de
 * stil nu s-a încărcat încă.
 */
export const STROKE = 1.75;
export const STROKE_ACTIVE = 2.5;

export interface IconProps {
  name: IconName;
  /** Starea activă: linie mai groasă. Vezi `STROKE_ACTIVE`. */
  active?: boolean;
  className?: string;
}

export function Icon({ name, active = false, className }: IconProps) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? STROKE_ACTIVE : STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
      data-active={active ? 'true' : 'false'}
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

export default Icon;
