/**
 * DE CE VALORILE SUNT SCRISE LITERAL AICI
 * ---------------------------------------
 * Versiunea anterioară a acestui fișier verifica tema închisă comparând
 * rezultatul cu `darkTheme.bg` — adică exact constanta pe care implementarea o
 * copiază (`buildPalette` face `{...(scheme === 'light' ? lightTheme : darkTheme)}`).
 * Un test construit așa nu poate pica NICIODATĂ: dacă cineva ar inversa cele
 * două palete în `mobile/theme/colors.ts`, `darkTheme.bg` ar deveni `#FFFFFF`,
 * aplicația ar redeveni ALBĂ — defectul raportat din producție — și toate
 * aserțiunile ar rămâne verzi, fiindcă se mișcă odată cu codul.
 *
 * Referința corectă e SPECIFICAȚIA, nu implementarea: paleta oficială
 * (`flirt_paleta_culori.png`, transcrisă în `mobile/theme/colors.ts` cu
 * mențiunea „valori EXACTE"). De aceea culorile care definesc identitatea
 * produsului sunt scrise mai jos ca hex, o singură dată, și verificate direct.
 */
import { describe, expect, it } from 'vitest';

import { darkTheme, lightTheme } from '@theme/colors';

import { applyTheme, buildPalette, buildThemeVars, PRODUCT_SCHEME } from '../applyTheme';
import { cssVarColors, toCssVarName } from '../tokens';

/** Paleta oficială FLIRT, scrisă din specificație — NU citită din cod. */
const SPEC = {
  darkBg: '#0D0D0F',
  darkSurface: '#1A1A1E',
  darkTextPrimary: '#FFFFFF',
  lightBg: '#FFFFFF',
  lightTextPrimary: '#141416',
  /** Roz-ul de brand: IDENTIC în ambele scheme, niciodată suprascris. */
  accent: '#FF2D78',
} as const;

/**
 * Tokenii de care depinde fiecare ecran. Scriși literal: dacă unul dispare din
 * paletă, `cssVarColors` s-ar micșora odată cu ea și o comparație „chei față de
 * chei" nu ar observa nimic, deși `var(--color-accent)` ar rămâne nedefinit în
 * DOM și butoanele și-ar pierde culoarea.
 */
const REQUIRED_TOKENS = [
  'bg',
  'surface',
  'surfaceHover',
  'border',
  'textPrimary',
  'textSecondary',
  'textDisabled',
  'link',
  'accent',
  'accentHover',
  'accentPressed',
  'accentDisabled',
  'tagBg',
  'success',
  'warning',
  'danger',
  'onAccent',
  'scrim',
] as const;

describe('paleta oficială (ancora testelor de mai jos)', () => {
  it('tema închisă are exact culorile din specificație', () => {
    expect(darkTheme.bg).toBe(SPEC.darkBg);
    expect(darkTheme.surface).toBe(SPEC.darkSurface);
    expect(darkTheme.textPrimary).toBe(SPEC.darkTextPrimary);
    expect(darkTheme.accent).toBe(SPEC.accent);
  });

  it('tema deschisă are exact culorile din specificație', () => {
    expect(lightTheme.bg).toBe(SPEC.lightBg);
    expect(lightTheme.textPrimary).toBe(SPEC.lightTextPrimary);
    expect(lightTheme.accent).toBe(SPEC.accent);
  });

  it('cele două palete NU sunt interschimbabile', () => {
    // Aserțiunea care prinde inversarea: fundalul închis e închis, cel deschis
    // e deschis. Fără ea, o inversare a exporturilor ar trece neobservată.
    expect(darkTheme.bg).not.toBe(lightTheme.bg);
    expect(darkTheme.bg.toUpperCase()).not.toBe('#FFFFFF');
  });
});

describe('buildPalette', () => {
  it('pornește de la paleta produsului pentru fiecare schemă', () => {
    expect(buildPalette('dark', {}).bg).toBe(SPEC.darkBg);
    expect(buildPalette('light', {}).bg).toBe(SPEC.lightBg);
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
    expect(palette.accent).toBe(SPEC.accent);
  });

  it('ignoră valorile care nu sunt culori', () => {
    const palette = buildPalette('light', {
      bg_color: '',
      text_color: 'rgb(1,2,3)',
      link_color: '#ABC',
    });
    expect(palette.bg).toBe(SPEC.lightBg);
    expect(palette.textPrimary).toBe(SPEC.lightTextPrimary);
    expect(palette.link).toBe('#ABC');
  });
});

describe('buildThemeVars', () => {
  it('transformă fiecare token într-o variabilă CSS', () => {
    const vars = buildThemeVars({ scheme: 'dark', params: {} });
    expect(vars['--color-surface-hover']).toBe('#232329');
    expect(vars['--color-text-primary']).toBe(SPEC.darkTextPrimary);
    expect(vars['--color-on-accent']).toBe('#FFFFFF');
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
    expect(root.style.getPropertyValue('--color-accent')).toBe(SPEC.accent);
    expect(root.dataset.colorScheme).toBe('dark');
  });

  it('comută corect între modul deschis și cel întunecat', () => {
    const root = document.createElement('div');
    applyTheme({ scheme: 'dark', params: {} }, root);
    expect(root.style.getPropertyValue('--color-bg')).toBe(SPEC.darkBg);

    applyTheme({ scheme: 'light', params: {} }, root);
    expect(root.style.getPropertyValue('--color-bg')).toBe(SPEC.lightBg);
    expect(root.dataset.colorScheme).toBe('light');
  });
});

describe('tokens', () => {
  it('numele variabilelor sunt derivate din cheile paletei mobile', () => {
    expect(toCssVarName('surfaceHover')).toBe('--color-surface-hover');
    expect(toCssVarName('bg')).toBe('--color-bg');
  });

  it('cssVarColors acoperă fiecare token de care depind ecranele', () => {
    // Lista e scrisă literal, nu derivată din paletă: altfel un token șters din
    // `colors.ts` ar dispărea din AMBELE părți ale comparației, iar testul ar
    // rămâne verde cu `var(--color-accent)` nedefinit în pagină.
    for (const token of REQUIRED_TOKENS) {
      expect(cssVarColors[token]).toBe(`var(${toCssVarName(token)})`);
    }
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
    expect(palette.bg).toBe(SPEC.darkBg);
    expect(palette.accent).toBe(SPEC.accent);
    expect(palette.textPrimary).toBe(SPEC.darkTextPrimary);
  });

  it('variabilele CSS se scriu și când nu primim nimic', () => {
    const vars = buildThemeVars({});
    expect(vars['--color-bg']).toBe(SPEC.darkBg);
    expect(vars['--color-accent']).toBe(SPEC.accent);
    expect(vars['--color-scheme']).toBe('dark');
  });

  it('`applyTheme()` fără argumente lasă pagina pe fundalul închis', () => {
    const root = document.createElement('div');
    applyTheme({}, root);

    expect(root.style.getPropertyValue('--color-bg')).toBe(SPEC.darkBg);
    expect(root.style.getPropertyValue('--color-bg')).not.toBe(SPEC.lightBg);
    expect(root.dataset.colorScheme).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
  });

  it('modul deschis apare DOAR dacă un client îl cere explicit', () => {
    expect(buildPalette('light', {}).bg).toBe(SPEC.lightBg);
    expect(buildPalette(undefined, {}).bg).toBe(SPEC.darkBg);
  });
});
