import { fireEvent, render, waitFor } from '@testing-library/react-native';
import i18n from 'i18next';
import React from 'react';

import { LanguageSwitcher } from '../LanguageSwitcher';
import { DEFAULT_LANGUAGE } from '@/i18n/config';
import { languageStore } from '@/i18n/languageStore';
import { ThemeProvider } from '@theme/index';

function renderSwitcher() {
  return render(
    <ThemeProvider>
      <LanguageSwitcher />
    </ThemeProvider>,
  );
}

describe('LanguageSwitcher', () => {
  // Fiecare test pornește de la limba implicită, ca ordinea lor să nu conteze.
  beforeEach(async () => {
    await languageStore.clear();
    await i18n.changeLanguage(DEFAULT_LANGUAGE);
  });

  afterAll(async () => {
    await languageStore.clear();
    await i18n.changeLanguage(DEFAULT_LANGUAGE);
  });

  it('arată exact trei coduri scurte, fără ucraineană', () => {
    const { getByText, queryByText } = renderSwitcher();

    expect(getByText('RO')).toBeTruthy();
    expect(getByText('RU')).toBeTruthy();
    expect(getByText('EN')).toBeTruthy();
    expect(queryByText('UK')).toBeNull();
  });

  it('marchează limba activă', () => {
    const { getByTestId } = renderSwitcher();

    expect(getByTestId('language-switch-ro').props.accessibilityState.selected).toBe(true);
    expect(getByTestId('language-switch-ru').props.accessibilityState.selected).toBe(false);
  });

  it('tap pe un cip comută limba și o persistă', async () => {
    const { getByTestId } = renderSwitcher();

    fireEvent.press(getByTestId('language-switch-ru'));

    await waitFor(() => expect(i18n.language).toBe('ru'));
    expect(getByTestId('language-switch-ru').props.accessibilityState.selected).toBe(true);
    await expect(languageStore.get()).resolves.toBe('ru');
  });

  /**
   * Cipul scrie „RU", dar cititorul de ecran ar silabisi „R-U". Eticheta de
   * accesibilitate trebuie să poarte numele întreg al limbii, în limba ei.
   */
  it('expune numele întreg al limbii pentru cititorul de ecran', () => {
    const { getByTestId } = renderSwitcher();

    expect(getByTestId('language-switch-ro').props.accessibilityLabel).toBe('Română');
    expect(getByTestId('language-switch-ru').props.accessibilityLabel).toBe('Русский');
    expect(getByTestId('language-switch-en').props.accessibilityLabel).toBe('English');
  });
});
