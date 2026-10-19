/**
 * Intrarea „Test de umor" din meniul „Mai multe" urmează comutatorul din panou:
 * dispare DOAR când serverul spune explicit că testul e oprit.
 */
import { describe, expect, it } from 'vitest';

import { MENU_ENTRIES, visibleMenuEntries } from '@/components/MoreScreen';

import { HUMOR_PATH } from '../humorRoutes';

describe('meniul și testul de umor', () => {
  it('testul oprit din panou → intrarea dispare, restul meniului rămâne', () => {
    const entries = visibleMenuEntries(false);
    expect(entries.some((e) => e.to === HUMOR_PATH)).toBe(false);
    expect(entries).toHaveLength(MENU_ENTRIES.length - 1);
  });

  it('testul pornit → intrarea e acolo', () => {
    expect(visibleMenuEntries(true).some((e) => e.to === HUMOR_PATH)).toBe(true);
  });

  it('starea necunoscută (încărcare / eroare) nu ascunde intrarea', () => {
    expect(visibleMenuEntries(undefined)).toEqual(MENU_ENTRIES);
  });
});
