/**
 * Rezolvarea direcției pentru deck-ul de ankete (TZ 4.4).
 *
 * Aceeași logică e folosită de DOUĂ surse de intrare — degetul (PanResponder) și
 * înclinarea telefonului (useTiltSwipe) — ca să nu existe două comportamente
 * diferite pentru „stânga" în funcție de cum a ajuns userul acolo.
 */

/** Cele patru direcții ale deck-ului. */
export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

/** Distanța (px) de la care un drag orizontal se consideră swipe. */
export const SWIPE_THRESHOLD_X = 110;

/**
 * Distanța (px) pentru vertical. Mai mare decât orizontalul (110): degetul
 * alunecă vertical mult mai ușor din greșeală când userul doar ține telefonul
 * sau se repoziționează, iar sus = super like, adică o acțiune pe care nu o poți
 * lua înapoi social. Preferăm un swipe ratat unui super like nedorit.
 */
export const SWIPE_THRESHOLD_Y = 140;

/**
 * Cât de mult trebuie să domine o axă ca gestul să conteze.
 * La 1.3, un gest la 45° (dx == dy) NU declanșează nimic — cardul revine.
 * Userul trebuie să fie clar în intenție, nu „aproape".
 */
export const AXIS_DOMINANCE = 1.3;

/**
 * Traduce un deplasament (dx, dy) într-o direcție, sau `null` dacă gestul e
 * prea mic ori prea ambiguu (diagonal). `null` înseamnă „cardul revine la loc".
 *
 * Axele ecranului: x creşte spre dreapta, y creşte în JOS.
 */
export function resolveDirection(
  dx: number,
  dy: number,
  thresholdX: number = SWIPE_THRESHOLD_X,
  thresholdY: number = SWIPE_THRESHOLD_Y,
): SwipeDirection | null {
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);

  // Orizontala domină clar → stânga/dreapta.
  if (adx >= ady * AXIS_DOMINANCE) {
    if (dx >= thresholdX) return 'right';
    if (dx <= -thresholdX) return 'left';
    return null;
  }

  // Verticala domină clar → sus/jos.
  if (ady >= adx * AXIS_DOMINANCE) {
    if (dy <= -thresholdY) return 'up';
    if (dy >= thresholdY) return 'down';
    return null;
  }

  // Nicio axă nu domină: gest diagonal, indecis. Nu ghicim.
  return null;
}
