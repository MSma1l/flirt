import { fireEvent, render, within } from '@testing-library/react-native';
import React from 'react';

import { ThemeProvider } from '@theme/index';

import { CountryPickerField } from '../CountryPickerField';

function renderField(props: Partial<React.ComponentProps<typeof CountryPickerField>> = {}) {
  const onChange = jest.fn();
  const utils = render(
    <ThemeProvider>
      <CountryPickerField label="Naționalitate" onChange={onChange} {...props} />
    </ThemeProvider>,
  );
  return { ...utils, onChange };
}

describe('CountryPickerField', () => {
  it('câmpul are rol de buton și etichetă accesibilă', () => {
    const { getByTestId } = renderField();
    const open = getByTestId('nationality-open');
    expect(open.props.accessibilityRole).toBe('button');
    expect(open.props.accessibilityLabel).toBe('Naționalitate');
  });

  it('fără valoare afișează placeholder „Alege țara"', () => {
    const { getByText } = renderField();
    expect(getByText('Alege țara')).toBeTruthy();
  });

  it('cu un cod ISO2 afișează numele + steagul țării', () => {
    const { getByText, getByTestId } = renderField({ value: 'MD' });
    expect(getByText('Republica Moldova')).toBeTruthy();
    // Mock-ul global de steag randează un Text cu testID `flag-<cod>`.
    expect(getByTestId('flag-MD')).toBeTruthy();
  });

  it('rezolvă și valorile vechi (nume liber) la afișare', () => {
    const { getByText } = renderField({ value: 'România' });
    expect(getByText('România')).toBeTruthy();
  });

  it('deschide modalul cu bară de căutare la apăsare', () => {
    const { getByTestId } = renderField();
    fireEvent.press(getByTestId('nationality-open'));
    expect(getByTestId('nationality-search')).toBeTruthy();
  });

  it('căutarea filtrează lista de țări', () => {
    const { getByTestId } = renderField();
    fireEvent.press(getByTestId('nationality-open'));

    fireEvent.changeText(getByTestId('nationality-search'), 'moldova');
    // Doar Moldova rămâne în listă; alte țări dispar.
    expect(getByTestId('country-item-MD')).toBeTruthy();
    expect(() => getByTestId('country-item-RO')).toThrow();
  });

  it('selectarea unei țări salvează CODUL ISO2 și închide modalul', () => {
    const { getByTestId, onChange, queryByTestId } = renderField();
    fireEvent.press(getByTestId('nationality-open'));

    fireEvent.changeText(getByTestId('nationality-search'), 'moldova');
    fireEvent.press(getByTestId('country-item-MD'));

    expect(onChange).toHaveBeenCalledWith('MD');
    // Modalul s-a închis: bara de căutare nu mai e în arbore.
    expect(queryByTestId('nationality-search')).toBeNull();
  });

  it('marchează ca selectată țara deja aleasă (accessibilityState)', () => {
    const { getByTestId } = renderField({ value: 'MD' });
    fireEvent.press(getByTestId('nationality-open'));
    fireEvent.changeText(getByTestId('nationality-search'), 'moldova');

    const item = getByTestId('country-item-MD');
    expect(item.props.accessibilityState.selected).toBe(true);
  });

  it('afișează stare goală „Nicio țară găsită." la un termen fără potrivire', () => {
    const { getByTestId, getByText } = renderField();
    fireEvent.press(getByTestId('nationality-open'));
    fireEvent.changeText(getByTestId('nationality-search'), 'zzzznope');
    expect(getByText('Nicio țară găsită.')).toBeTruthy();
  });

  it('butonul „Închide" are hitSlop și închide modalul', () => {
    const { getByTestId, queryByTestId } = renderField();
    fireEvent.press(getByTestId('nationality-open'));

    const close = getByTestId('nationality-close');
    expect(close.props.hitSlop).toBe(12);
    fireEvent.press(close);
    expect(queryByTestId('nationality-search')).toBeNull();
  });

  it('fiecare rând de țară din listă e un buton accesibil', () => {
    const { getByTestId } = renderField();
    fireEvent.press(getByTestId('nationality-open'));
    fireEvent.changeText(getByTestId('nationality-search'), 'moldova');
    const row = getByTestId('country-item-MD');
    expect(row.props.accessibilityRole).toBe('button');
    // Rândul conține și steagul.
    expect(within(row).getByTestId('flag-MD')).toBeTruthy();
  });
});
