/** Reordonarea pozelor — funcție pură, folosită de wizard, de profil și de grilă. */

/**
 * Mută elementul de la `from` la `to`, întorcând o listă NOUĂ.
 * Indecșii în afara intervalului sau `from === to` → lista neschimbată (copie).
 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= next.length ||
    to >= next.length
  ) {
    return next;
  }
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
