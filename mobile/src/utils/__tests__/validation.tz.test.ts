/**
 * BUG CONFIRMAT — poarta de 18+ (`isAdultAge`) e dependentă de fusul orar.
 *
 * `isAdultAge` parsează data nașterii cu `new Date("YYYY-MM-DD")`, care în JS
 * înseamnă MIEZUL NOPȚII UTC. `computeAge` citește apoi ziua/luna/anul cu
 * getterele LOCALE (`getFullYear/getMonth/getDate`). În orice fus NEGATIV
 * (toată America), miezul nopții UTC cade în ziua CALENDARISTICĂ PRECEDENTĂ,
 * deci ziua de naștere se mută cu o zi înapoi și vârsta iese cu o zi „mai mare".
 *
 * Efect: un minor care împlinește 18 ani MÂINE trece de poarta 18+ AZI —
 * exact eșecul de conformitate 18+ pe care aplicația nu și-l permite.
 *
 * Testul rulează cu TZ forțat pe un fus negativ real (America/New_York), pentru
 * că verificarea locală de dezvoltare (Europe/Chisinau, fus pozitiv) maschează
 * defectul. RULEAZĂ: `TZ=America/New_York npx jest validation.tz`.
 */
import { computeAge, isAdultAge } from '@/utils/validation';

describe('isAdultAge — dependență de fus orar (BUG)', () => {
  it('respinge un minor care împlinește 18 ani abia mâine', () => {
    // „Azi" = 2026-07-14 (ora locală). Născut 2026-07-15 acum 18 ani => 2008-07-15.
    // Pe 2026-07-14 persoana are 17 ani (ziua de naștere e MÂINE) => trebuie RESPINSĂ.
    const now = new Date(2026, 6, 14, 12, 0, 0);
    const result = isAdultAge('2008-07-15', now);

    // Corect: un mesaj de eroare (minor). Cu bug-ul, în fus negativ, => null (acceptat).
    expect(result).not.toBeNull();
  });

  it('computeAge nu adaugă o zi în plus din cauza parsării UTC', () => {
    const now = new Date(2026, 6, 14, 12, 0, 0);
    // Născut 2008-07-15 => pe 2026-07-14 are 17 ani împliniți, nu 18.
    expect(computeAge(new Date('2008-07-15'), now)).toBe(17);
  });
});
