import { darkTheme } from '@theme/colors';

import { compatColor, compatLabel } from '../compat';

describe('compatColor', () => {
  it('întoarce verde (success) pentru scor > 80', () => {
    expect(compatColor(81, darkTheme)).toBe(darkTheme.success);
  });

  it('întoarce galben (warning) pentru scor între 50 și 80', () => {
    expect(compatColor(65, darkTheme)).toBe(darkTheme.warning);
    expect(compatColor(50, darkTheme)).toBe(darkTheme.warning);
    expect(compatColor(80, darkTheme)).toBe(darkTheme.warning);
  });

  it('întoarce gri (textDisabled) pentru scor < 50', () => {
    expect(compatColor(30, darkTheme)).toBe(darkTheme.textDisabled);
    expect(compatColor(49, darkTheme)).toBe(darkTheme.textDisabled);
  });
});

describe('compatLabel', () => {
  // Modul pur: întoarce CHEIA, textul îl produce `t` la afișare (vezi CompatBadge).
  it('alege cheia în funcție de prag', () => {
    expect(compatLabel(81)).toBe('compat.excellent');
    expect(compatLabel(65)).toBe('compat.good');
    expect(compatLabel(30)).toBe('compat.weak');
  });
});
