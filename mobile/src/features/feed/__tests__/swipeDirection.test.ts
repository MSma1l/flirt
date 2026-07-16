import {
  AXIS_DOMINANCE,
  resolveDirection,
  SWIPE_THRESHOLD_X,
  SWIPE_THRESHOLD_Y,
} from '../swipeDirection';

describe('resolveDirection', () => {
  it('rezolvă cele 4 direcții când gestul e clar și peste prag', () => {
    expect(resolveDirection(SWIPE_THRESHOLD_X + 10, 0)).toBe('right');
    expect(resolveDirection(-SWIPE_THRESHOLD_X - 10, 0)).toBe('left');
    expect(resolveDirection(0, -SWIPE_THRESHOLD_Y - 10)).toBe('up');
    expect(resolveDirection(0, SWIPE_THRESHOLD_Y + 10)).toBe('down');
  });

  it('exact pe prag declanșează (pragul e inclusiv)', () => {
    expect(resolveDirection(SWIPE_THRESHOLD_X, 0)).toBe('right');
    expect(resolveDirection(0, SWIPE_THRESHOLD_Y)).toBe('down');
  });

  it('sub prag nu declanșează nimic — cardul revine', () => {
    expect(resolveDirection(SWIPE_THRESHOLD_X - 1, 0)).toBeNull();
    expect(resolveDirection(-SWIPE_THRESHOLD_X + 1, 0)).toBeNull();
    expect(resolveDirection(0, -SWIPE_THRESHOLD_Y + 1)).toBeNull();
    expect(resolveDirection(0, SWIPE_THRESHOLD_Y - 1)).toBeNull();
    expect(resolveDirection(0, 0)).toBeNull();
  });

  it('gest diagonal la 45° nu declanșează nimic, oricât de amplu ar fi', () => {
    // Ambele axe peste prag, dar niciuna nu domină: intenția e neclară.
    expect(resolveDirection(300, 300)).toBeNull();
    expect(resolveDirection(-300, 300)).toBeNull();
    expect(resolveDirection(300, -300)).toBeNull();
    expect(resolveDirection(-300, -300)).toBeNull();
  });

  it('o axă trebuie să domine cu factorul cerut ca să câștige', () => {
    // Chiar sub pragul de dominanță → ambiguu.
    const dy = 100;
    expect(resolveDirection(dy * (AXIS_DOMINANCE - 0.1), dy)).toBeNull();
    // Peste pragul de dominanță și peste distanță → orizontala câștigă.
    expect(resolveDirection(dy * (AXIS_DOMINANCE + 0.1), dy)).toBe('right');
  });

  it('verticalul cere o distanță mai mare decât orizontalul (super like accidental)', () => {
    expect(SWIPE_THRESHOLD_Y).toBeGreaterThan(SWIPE_THRESHOLD_X);
    // Un drag în sus de mărimea pragului orizontal NU e încă super like.
    expect(resolveDirection(0, -SWIPE_THRESHOLD_X)).toBeNull();
  });

  it('un drag vertical dominant, dar scurt, nu devine swipe orizontal', () => {
    expect(resolveDirection(5, -60)).toBeNull();
  });
});
