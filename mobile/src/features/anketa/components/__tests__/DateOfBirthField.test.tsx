import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { Platform } from 'react-native';

import { ThemeProvider } from '@theme/index';

import {
  DateOfBirthField,
  formatDisplayDate,
  maxBirthDate,
  parseIsoDate,
  toIsoDate,
} from '../DateOfBirthField';
import { MIN_AGE } from '../../validation';

// Suprascriem mock-ul global de datetimepicker cu unul CONTROLABIL: fiecare test
// poate seta ce dată „alege" userul din calendar, ca să exercităm și clamp-ul 18+.
let mockPickedDate = new Date(2000, 0, 15);
jest.mock('@react-native-community/datetimepicker', () => {
  const RNReact = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    __esModule: true,
    default: function MockPicker(props: { testID?: string; onChange?: (e: unknown, d?: Date) => void }) {
      return RNReact.createElement(
        Pressable,
        {
          testID: props.testID || 'birthdate-picker',
          onPress: () => props.onChange?.({ type: 'set' }, mockPickedDate),
        },
        RNReact.createElement(Text, null, 'date-picker'),
      );
    },
  };
});

function renderField(props: Partial<React.ComponentProps<typeof DateOfBirthField>> = {}) {
  const onChange = jest.fn();
  const utils = render(
    <ThemeProvider>
      <DateOfBirthField label="Data nașterii" onChange={onChange} {...props} />
    </ThemeProvider>,
  );
  return { ...utils, onChange };
}

describe('DateOfBirthField — funcții pure', () => {
  it('maxBirthDate = azi − MIN_AGE ani (pragul de adult 18+)', () => {
    const now = new Date(2026, 6, 24); // 24.07.2026
    const max = maxBirthDate(now);
    expect(max.getFullYear()).toBe(2026 - MIN_AGE);
    expect(max.getMonth()).toBe(6);
    expect(max.getDate()).toBe(24);
  });

  it('toIsoDate formatează ISO local YYYY-MM-DD fără drift de fus', () => {
    expect(toIsoDate(new Date(2000, 0, 5))).toBe('2000-01-05');
    expect(toIsoDate(new Date(1999, 11, 31))).toBe('1999-12-31');
  });

  it('parseIsoDate parsează un ISO valid și respinge gunoiul', () => {
    const d = parseIsoDate('2000-01-15');
    expect(d?.getFullYear()).toBe(2000);
    expect(d?.getMonth()).toBe(0);
    expect(d?.getDate()).toBe(15);
    expect(parseIsoDate('nu-e-data')).toBeUndefined();
    expect(parseIsoDate(undefined)).toBeUndefined();
    expect(parseIsoDate('')).toBeUndefined();
  });

  it('formatDisplayDate afișează dd.mm.yyyy (sau null pentru invalid)', () => {
    expect(formatDisplayDate('2000-01-05')).toBe('05.01.2000');
    expect(formatDisplayDate('gunoi')).toBeNull();
    expect(formatDisplayDate(undefined)).toBeNull();
  });
});

describe('DateOfBirthField — UI/UX', () => {
  beforeEach(() => {
    mockPickedDate = new Date(2000, 0, 15);
    Platform.OS = 'android';
  });

  it('are rolul de buton și eticheta accesibilă pe câmp', () => {
    const { getByTestId } = renderField();
    const open = getByTestId('birthdate-open');
    expect(open.props.accessibilityRole).toBe('button');
    expect(open.props.accessibilityLabel).toBe('Data nașterii');
  });

  it('afișează placeholder când nu există valoare', () => {
    const { getByText } = renderField();
    expect(getByText('Alege data din calendar')).toBeTruthy();
  });

  it('afișează valoarea formatată dd.mm.yyyy când există', () => {
    const { getByText } = renderField({ value: '1995-03-08' });
    expect(getByText('08.03.1995')).toBeTruthy();
  });

  it('afișează mesajul de eroare când e furnizat', () => {
    const { getByText } = renderField({ error: 'Trebuie să ai cel puțin 18 ani.' });
    expect(getByText('Trebuie să ai cel puțin 18 ani.')).toBeTruthy();
  });

  it('alegerea unei date adulte din picker trimite ISO în sus', () => {
    mockPickedDate = new Date(2000, 0, 15);
    const { getByTestId, onChange } = renderField();

    fireEvent.press(getByTestId('birthdate-open'));
    fireEvent.press(getByTestId('birthdate-picker'));

    expect(onChange).toHaveBeenCalledWith('2000-01-15');
  });

  it('ENFORCE 18+: o dată care te face minor e clampată la pragul de adult', () => {
    // Userul „alege" AZI (0 ani) — plasa de siguranță o urcă la pragul 18+.
    mockPickedDate = new Date();
    const max = maxBirthDate();
    const { getByTestId, onChange } = renderField();

    fireEvent.press(getByTestId('birthdate-open'));
    fireEvent.press(getByTestId('birthdate-picker'));

    // Nu se trimite data de azi, ci exact pragul de adult (azi − 18 ani).
    expect(onChange).toHaveBeenCalledWith(toIsoDate(max));
    expect(onChange).not.toHaveBeenCalledWith(toIsoDate(new Date()));
  });
});
