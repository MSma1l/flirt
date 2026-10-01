import { describe, expect, it } from 'vitest';

import { initialPathFromStartParam } from '../startParamRoute';

describe('initialPathFromStartParam', () => {
  it('duce butoanele botului la ecranele lor', () => {
    expect(initialPathFromStartParam('events')).toBe('/events');
    expect(initialPathFromStartParam('tickets')).toBe('/tickets');
    expect(initialPathFromStartParam('privacy')).toBe('/legal');
  });

  it('lasă pornirea neschimbată pentru parametri necunoscuți sau lipsă', () => {
    expect(initialPathFromStartParam(null)).toBe('/');
    expect(initialPathFromStartParam('')).toBe('/');
    expect(initialPathFromStartParam('INVITE-ABCD2345')).toBe('/');
  });
});
