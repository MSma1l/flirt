import { describe, expect, it, vi } from 'vitest';

import { installTelegramStub } from '@/test/telegramStub';

import {
  compareVersions,
  disableVerticalSwipes,
  expand,
  getColorScheme,
  getContentSafeAreaInset,
  getLanguageCode,
  getRawInitData,
  getSafeAreaInset,
  getUnsafeUser,
  getViewportStableHeight,
  getWebApp,
  haptic,
  isInsideTelegram,
  isVersionAtLeast,
  onEvent,
  openTelegramLink,
  ready,
  showBackButton,
  showMainButton,
} from '../bridge';

describe('puntea Telegram — în afara Telegram', () => {
  it('raportează că nu suntem în Telegram', () => {
    expect(getWebApp()).toBeNull();
    expect(isInsideTelegram()).toBe(false);
  });

  it('programul incarcat intr-un browser obisnuit NU inseamna client Telegram', () => {
    // Regresie pentru un defect vizibil in productie: programul oficial se
    // incarca de pe telegram.org in ORICE browser, deci obiectul exista si in
    // Chrome. Acolo raporteaza platforma „unknown", parametri de tema zero si
    // date de intrare goale. Verificarea slaba il trata ca sesiune Telegram,
    // prelua schema „deschis" implicita si pagina ajungea alba, peste paleta
    // inchisa a produsului.
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        ready: () => {},
        platform: 'unknown',
        version: '6.0',
        colorScheme: 'light',
        initData: '',
        initDataUnsafe: {},
        themeParams: {},
      },
    };

    expect(isInsideTelegram()).toBe(false);

    delete (window as unknown as { Telegram?: unknown }).Telegram;
  });

  it.each(['tdesktop', 'android', 'ios', 'web', 'macos'])(
    'platforma reala „%s" inseamna client Telegram',
    (platform) => {
      (window as unknown as { Telegram: unknown }).Telegram = {
        WebApp: { ready: () => {}, platform, version: '7.0', colorScheme: 'dark' },
      };

      expect(isInsideTelegram()).toBe(true);

      delete (window as unknown as { Telegram?: unknown }).Telegram;
    },
  );

  it('nu aruncă la niciun apel și întoarce valori implicite', () => {
    expect(() => {
      ready();
      expand();
      haptic();
      disableVerticalSwipes();
    }).not.toThrow();

    expect(getRawInitData()).toBe('');
    expect(getUnsafeUser()).toBeNull();
    expect(getLanguageCode()).toBeNull();
    expect(getSafeAreaInset()).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
    expect(isVersionAtLeast('6.0')).toBe(false);
  });

  it('întoarce dezabonări inofensive pentru evenimente și butoane', () => {
    const offEvent = onEvent('themeChanged', () => {});
    const hideBack = showBackButton(() => {});
    const hideMain = showMainButton({ text: 'Ok', onClick: () => {} });
    expect(() => {
      offEvent();
      hideBack();
      hideMain();
    }).not.toThrow();
  });

  it('cade pe înălțimea ferestrei browserului', () => {
    expect(getViewportStableHeight()).toBe(window.innerHeight);
  });

  it('ignoră un obiect global incomplet (SDK neîncărcat complet)', () => {
    window.Telegram = { WebApp: {} as never };
    expect(getWebApp()).toBeNull();
    expect(getRawInitData()).toBe('');
  });
});

describe('puntea Telegram — înăuntru', () => {
  it('cheamă ready/expand pe client', () => {
    const { webApp } = installTelegramStub();
    ready();
    expand();
    expect(webApp.ready).toHaveBeenCalledOnce();
    expect(webApp.expand).toHaveBeenCalledOnce();
  });

  it('dă datele brute și pe cele nesigure separat', () => {
    const { webApp } = installTelegramStub();
    expect(getRawInitData()).toBe(webApp.initData);
    expect(getUnsafeUser()?.first_name).toBe('Ana');
    expect(getLanguageCode()).toBe('ro');
  });

  it('nu aruncă dacă o metodă a clientului aruncă', () => {
    installTelegramStub({
      ready: vi.fn(() => {
        throw new Error('client vechi');
      }),
    });
    expect(() => ready()).not.toThrow();
  });

  it('citește marginile de siguranță raportate de client', () => {
    installTelegramStub({
      safeAreaInset: { top: 44, bottom: 34, left: 0, right: 0 },
      contentSafeAreaInset: { top: 56, bottom: 0, left: 0, right: 0 },
    });
    expect(getSafeAreaInset().top).toBe(44);
    expect(getContentSafeAreaInset().top).toBe(56);
  });

  it('nu cere margini de siguranță unui client sub Bot API 8.0', () => {
    installTelegramStub({
      version: '6.9',
      safeAreaInset: { top: 44, bottom: 34, left: 0, right: 0 },
    });
    // Pe 6.9 câmpul nu există cu adevărat, chiar dacă stub-ul îl are: puntea
    // trebuie să întoarcă zero, nu o valoare în care nu putem avea încredere.
    expect(getSafeAreaInset()).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });

  it('nu arată butonul Înapoi pe un client sub 6.1', () => {
    const { webApp } = installTelegramStub({ version: '6.0' });
    showBackButton(() => {});
    expect(webApp.BackButton.show).not.toHaveBeenCalled();
  });

  it('arată și ascunde butonul Înapoi', () => {
    const { webApp } = installTelegramStub();
    const onBack = vi.fn();
    const hide = showBackButton(onBack);
    expect(webApp.BackButton.onClick).toHaveBeenCalledWith(onBack);
    expect(webApp.BackButton.show).toHaveBeenCalledOnce();
    hide();
    expect(webApp.BackButton.offClick).toHaveBeenCalledWith(onBack);
    expect(webApp.BackButton.hide).toHaveBeenCalledOnce();
  });

  it('configurează butonul principal, inclusiv starea dezactivată și rotița', () => {
    const { webApp } = installTelegramStub();
    const hide = showMainButton({
      text: 'Trimite',
      onClick: () => {},
      enabled: false,
      loading: true,
    });
    expect(webApp.MainButton.setText).toHaveBeenCalledWith('Trimite');
    expect(webApp.MainButton.disable).toHaveBeenCalledOnce();
    expect(webApp.MainButton.showProgress).toHaveBeenCalledOnce();
    expect(webApp.MainButton.show).toHaveBeenCalledOnce();
    hide();
    expect(webApp.MainButton.hide).toHaveBeenCalledOnce();
  });

  it('abonează și dezabonează evenimente', () => {
    const stub = installTelegramStub();
    const cb = vi.fn();
    const off = onEvent('themeChanged', cb);
    stub.emit('themeChanged');
    expect(cb).toHaveBeenCalledOnce();
    off();
    stub.emit('themeChanged');
    expect(cb).toHaveBeenCalledOnce();
  });

  it('nu cheamă disableVerticalSwipes pe un client sub 7.7', () => {
    const { webApp } = installTelegramStub({ version: '7.0' });
    disableVerticalSwipes();
    expect(webApp.disableVerticalSwipes).not.toHaveBeenCalled();
  });

  it('cheamă disableVerticalSwipes de la 7.7 în sus', () => {
    const { webApp } = installTelegramStub({ version: '7.7' });
    disableVerticalSwipes();
    expect(webApp.disableVerticalSwipes).toHaveBeenCalledOnce();
  });

  it('cade pe comparația proprie dacă isVersionAtLeast lipsește', () => {
    installTelegramStub({
      version: '7.8',
      isVersionAtLeast: undefined as never,
    });
    expect(isVersionAtLeast('7.7')).toBe(true);
    expect(isVersionAtLeast('8.0')).toBe(false);
  });
});

describe('compareVersions', () => {
  it('compară pe segmente numerice, nu lexicografic', () => {
    expect(compareVersions('6.10', '6.9')).toBe(1);
    expect(compareVersions('7.0', '7')).toBe(0);
    expect(compareVersions('6.9', '8.0')).toBe(-1);
  });
});

/**
 * Schema implicită și deschiderea linkurilor — ele fac diferența dintre pagina
 * albă raportată de proprietar și un ecran al produsului cu drum de întoarcere.
 */
describe('schema de culori și linkurile către bot', () => {
  it('în afara Telegram schema e cea ÎNCHISĂ a produsului, nu `light`', () => {
    expect(getColorScheme()).toBe('dark');
  });

  it('în Telegram urmează clientul, când acesta trimite și paleta', () => {
    // Un client real pe temă deschisă trimite ÎNTOTDEAUNA `themeParams`.
    // Cazul „deschis, dar fără nicio culoare" nu vine de la un client real —
    // vezi `bridgeHardening.test.ts`, unde e tratat ca ceea ce este: o adresă
    // deschisă în browser cu fragmentul scris de mână.
    installTelegramStub({
      colorScheme: 'light',
      themeParams: { bg_color: '#ffffff', text_color: '#000000' },
    } as never);
    expect(getColorScheme()).toBe('light');

    installTelegramStub({ colorScheme: 'dark' } as never);
    expect(getColorScheme()).toBe('dark');
  });

  it('în afara Telegram nu preia deschiderea linkului', () => {
    expect(openTelegramLink('https://t.me/bot')).toBe(false);
  });

  it('în Telegram folosește `openTelegramLink`', () => {
    const openTelegramLinkSpy = vi.fn();
    installTelegramStub({ openTelegramLink: openTelegramLinkSpy } as never);

    expect(openTelegramLink('https://t.me/bot')).toBe(true);
    expect(openTelegramLinkSpy).toHaveBeenCalledWith('https://t.me/bot');
  });

  it('pe clienți fără `openTelegramLink` cade pe `openLink`', () => {
    const openLink = vi.fn();
    installTelegramStub({ openLink } as never);

    expect(openTelegramLink('https://t.me/bot')).toBe(true);
    expect(openLink).toHaveBeenCalledWith('https://t.me/bot');
  });

  it('un client care aruncă nu blochează legătura obișnuită', () => {
    installTelegramStub({
      openTelegramLink: () => {
        throw new Error('nu e suportat');
      },
    } as never);

    expect(openTelegramLink('https://t.me/bot')).toBe(false);
  });
});
