import { act, renderHook, waitFor } from '@testing-library/react-native';

import { DEFAULT_LANGUAGE } from '../config';
import i18n from '../index';
import { languageStore } from '../languageStore';
import { useLanguage } from '../useLanguage';

describe('useLanguage', () => {
  beforeEach(async () => {
    await languageStore.clear();
    await i18n.changeLanguage(DEFAULT_LANGUAGE);
  });

  afterAll(async () => {
    await languageStore.clear();
    await i18n.changeLanguage(DEFAULT_LANGUAGE);
  });

  it('expune limba activă și lista de limbi cu numele lor native', () => {
    const { result } = renderHook(() => useLanguage());

    expect(result.current.current).toBe('ro');
    expect(result.current.available).toEqual(['ro', 'ru', 'uk', 'en']);
    expect(result.current.labels.uk).toBe('Українська');
  });

  it('schimbă limba și re-randează consumatorul', async () => {
    const { result } = renderHook(() => useLanguage());

    await act(async () => {
      await result.current.setLanguage('uk');
    });

    await waitFor(() => expect(result.current.current).toBe('uk'));
    expect(i18n.language).toBe('uk');
  });

  it('persistă alegerea, ca să supraviețuiască repornirii', async () => {
    const { result } = renderHook(() => useLanguage());

    await act(async () => {
      await result.current.setLanguage('ru');
    });

    await expect(languageStore.get()).resolves.toBe('ru');
  });
});
