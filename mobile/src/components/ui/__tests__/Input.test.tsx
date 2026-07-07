import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { ThemeProvider } from '@theme/index';
import { darkTheme, lightTheme } from '@theme/colors';

import { Input } from '../Input';

function renderInput(props: React.ComponentProps<typeof Input> = {}) {
  return render(
    <ThemeProvider>
      <Input {...props} />
    </ThemeProvider>,
  );
}

/** Aplatizează stilul unui element (posibil array) într-un singur obiect. */
function flatStyle(el: { props: { style: unknown } }): Record<string, unknown> {
  const raw = el.props.style;
  const arr = Array.isArray(raw) ? raw.flat(Infinity) : [raw];
  return Object.assign({}, ...arr.filter(Boolean));
}

describe('Input', () => {
  it('afișează label-ul când e furnizat', () => {
    const { getByText } = renderInput({ label: 'Email' });
    expect(getByText('Email')).toBeTruthy();
  });

  it('afișează mesajul de eroare când e furnizat', () => {
    const { getByText } = renderInput({ label: 'Email', error: 'Email invalid' });
    expect(getByText('Email invalid')).toBeTruthy();
  });

  it('forwardează onChangeText', () => {
    const onChangeText = jest.fn();
    const { getByPlaceholderText } = renderInput({
      placeholder: 'Scrie...',
      onChangeText,
    });
    fireEvent.changeText(getByPlaceholderText('Scrie...'), 'salut');
    expect(onChangeText).toHaveBeenCalledWith('salut');
  });

  it('focus schimbă culoarea border-ului spre accent și apelează onFocus', () => {
    const onFocus = jest.fn();
    const { getByPlaceholderText } = renderInput({ placeholder: 'Scrie...', onFocus });
    const field = getByPlaceholderText('Scrie...');

    // Neutru la început (tema activă poate fi light sau dark).
    const initial = flatStyle(field).borderColor;
    expect([darkTheme.border, lightTheme.border]).toContain(initial);

    fireEvent(field, 'focus');
    expect(onFocus).toHaveBeenCalledTimes(1);
    // `accent` este identic în ambele teme; devine culoarea de focus.
    expect(flatStyle(field).borderColor).toBe(darkTheme.accent);

    fireEvent(field, 'blur');
    expect(flatStyle(field).borderColor).toBe(initial);
  });

  it('eroarea are prioritate asupra focusului la culoarea border-ului', () => {
    const { getByPlaceholderText } = renderInput({
      placeholder: 'Scrie...',
      error: 'greșit',
    });
    const field = getByPlaceholderText('Scrie...');
    fireEvent(field, 'focus');
    // Cu eroare, border-ul este `danger`, nu accent.
    expect([darkTheme.danger, lightTheme.danger]).toContain(flatStyle(field).borderColor);
  });
});
