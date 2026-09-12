import { describe, expect, it } from 'vitest';

import { darkTheme, lightTheme } from '@theme/colors';

import { applyTheme, buildPalette, buildThemeVars, PRODUCT_SCHEME } from '../applyTheme';
import { cssVarColors, toCssVarName } from '../tokens';

describe('buildPalette', () => {
  it('pornește de la paleta produsului pentru fiecare schemă', () => {
    expect(buildPalette('dark', {}).bg).toBe(darkTheme.bg);
    expect(buildPalette('light', {}).bg).toBe(lightTheme.bg);
  });

  it('respectă culorile trimise de Telegram', () => {
    const palette = buildPalette('dark', {
      bg_color: '#101820',
      text_color: '#F0F0F0',
      hint_color: '#8A8A8A',
      secondary_bg_color: '#1B2430',
    });
    expect(palette.bg).toBe('#101820');
    expect(palette.textPrimary).toBe('#F0F0F0');
    expect(palette.textSecondary).toBe('#8A8A8A');
    expect(palette.surface).toBe('#1B2430');
  });

  it('păstrează accentul de brand, orice ar trimite clientul', () => {
    const palette = buildPalette('dark', { button_color: '#0088CC', bg_color: '#000000' });
    expect(palette.accent).toBe(darkTheme.accent);
  });

  it('ignoră valorile care nu sunt culori', () => {
    const palette = buildPalette('light', {
      bg_color: '',
      text_color: 'rgb(1,2,3)',
      link_color: '#ABC',
    });
    expect(palette.bg).toBe(lightTheme.bg);
    expect(palette.textPrimary).toBe(lightTheme.textPrimary);
    expect(palette.link).toBe('#ABC');
  });
});

describe('buildThemeVars', () => {
  it('transformă fiecare token într-o variabilă CSS', () => {
    const vars = buildThemeVars({ scheme: 'dark', params: {} });
    expect(vars['--color-surface-hover']).toBe(darkTheme.surfaceHover);
    expect(vars['--color-text-primary']).toBe(darkTheme.textPrimary);
    expect(vars['--color-on-accent']).toBe(darkTheme.onAccent);
  });

  it('însumează marginile dispozitivului cu cele ale zonei de conținut', () => {
    const vars = buildThemeVars({
      scheme: 'dark',
      params: {},
      safeArea: { top: 44, bottom: 34, left: 0, right: 0 },
      contentSafeArea: { top: 56, bottom: 0, left: 0, right: 0 },
    });
    // Antetul clientului (56) nu e vizibil pentru `env(safe-area-inset-top)`,
    // de aceea îl adunăm noi.
    expect(vars['--safe-top']).toBe('100px');
    expect(vars['--safe-bottom']).toBe('34px');
  });

  it('nu scrie înălțimea ferestrei dacă nu o cunoaște', () => {
    const vars = buildThemeVars({ scheme: 'light', params: {}, stableHeight: 0 });
    expect(vars['--viewport-stable-height']).toBeUndefined();
  });

  it('scrie înălțimea stabilă când o primește', () => {
    const vars = buildThemeVars({ scheme: 'light', params: {}, stableHeight: 640 });
    expect(vars['--viewport-stable-height']).toBe('640px');
  });
});

describe('applyTheme', () => {
  it('scrie variabilele pe element și marchează schema', () => {
    const root = document.createElement('div');
    applyTheme({ scheme: 'dark', params: { bg_color: '#111111' } }, root);

    expect(root.style.getPropertyValue('--color-bg')).toBe('#111111');
    expect(root.style.getPropertyValue('--color-accent')).toBe(darkTheme.accent);
    expect(root.dataset.colorScheme).toBe('dark');
  });

  it('comută corect între modul deschis și cel întunecat', () => {
    const root = document.createElement('div');
    applyTheme({ scheme: 'dark', params: {} }, root);
    expect(root.style.getPropertyValue('--color-bg')).toBe(darkTheme.bg);

    applyTheme({ scheme: 'light', params: {} }, root);
    expect(root.style.getPropertyValue('--color-bg')).toBe(lightTheme.bg);
    expect(root.dataset.colorScheme).toBe('light');
  });
});

describe('tokens', () => {
  it('numele variabilelor sunt derivate din cheile paletei mobile', () => {
    expect(toCssVarName('surfaceHover')).toBe('--color-surface-hover');
    expect(toCssVarName('bg')).toBe('--color-bg');
  });

  it('cssVarColors are exact aceleași chei ca paleta mobilă', () => {
    expect(Object.keys(cssVarColors).sort()).toEqual(Object.keys(darkTheme).sort());
    expect(cssVarColors.success).toBe('var(--color-success)');
  });
});

/**
 * DEFECTUL RAPORTAT: adresa Mini App-ului deschisă în Chrome dădea o pagină
 * ALBĂ, fără culorile produsului. În afara Telegram nu există nici schemă,
 * nici `themeParams` — iar atunci tema trebuie să fie a NOASTRĂ, cea închisă.
 */
describe('tema fără niciun parametru de la Telegram', () => {
  it('tema produsului e cea închisă', () => {
    expect(PRODUCT_SCHEME).toBe('dark');
  });

  it('fără schemă și fără parametri, paleta e cea închisă a produsului', () => {
    const palette = buildPalette(undefined, undefined);
    expect(palette.bg).toBe(darkTheme.bg);
    expect(palette.accent).toBe(darkTheme.accent);
    expect(palette.textPrimary).toBe(darkTheme.textPrimary);
  });

  it('variabilele CSS se scriu și când nu primim nimic', () => {
    const vars = buildThemeVars({});
    expect(vars['--color-bg']).toBe(darkTheme.bg);
    expect(vars['--color-accent']).toBe(darkTheme.accent);
    expect(vars['--color-scheme']).toBe('dark');
  });

  it('`applyTheme()` fără argumente lasă pagina pe fundalul închis', () => {
    const root = document.createElement('div');
    applyTheme({}, root);

    expect(root.style.getPropertyValue('--color-bg')).toBe(darkTheme.bg);
    expect(root.style.getPropertyValue('--color-bg')).not.toBe(lightTheme.bg);
    expect(root.dataset.colorScheme).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
  });

  it('modul deschis apare DOAR dacă un client îl cere explicit', () => {
    expect(buildPalette('light', {}).bg).toBe(lightTheme.bg);
    expect(buildPalette(undefined, {}).bg).toBe(darkTheme.bg);
  });
});
