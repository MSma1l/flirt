import { fireEvent, render, waitFor } from '@testing-library/react-native';
import i18n from 'i18next';
import React from 'react';

import { LanguagePicker } from '../LanguagePicker';
import { ThemeProvider } from '@theme/index';

function renderPicker() {
  return render(
    <ThemeProvider>
      <LanguagePicker />
    </ThemeProvider>,
  );
}

describe('LanguagePicker', () => {
  // Fiecare test pornește de la limba implicită, ca ordinea lor să nu conteze.
  beforeEach(async () => {
    await i18n.changeLanguage('ro');
  });

  it('arată cele 4 limbi cu numele lor (endonime)', () => {
    const { getByText } = renderPicker();
    expect(getByText('Română')).toBeTruthy();
    expect(getByText('Русский')).toBeTruthy();
    expect(getByText('Українська')).toBeTruthy();
    expect(getByText('English')).toBeTruthy();
  });

  it('marchează vizual limba activă', () => {
    const { getByTestId } = renderPicker();
    expect(getByTestId('language-ro').props.accessibilityState.selected).toBe(true);
    expect(getByTestId('language-uk').props.accessibilityState.selected).toBe(false);
  });

  it('tap pe o limbă o comută (i18next se schimbă)', async () => {
    const { getByTestId } = renderPicker();

    fireEvent.press(getByTestId('language-uk'));

    await waitFor(() => expect(i18n.language).toBe('uk'));
    expect(getByTestId('language-uk').props.accessibilityState.selected).toBe(true);
  });
});
