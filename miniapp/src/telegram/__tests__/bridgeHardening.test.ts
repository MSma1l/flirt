/**
 * Două defecte din aceeași familie cu cele ajunse în producție.
 *
 * 1. DEDUCEREA MEDIULUI DINTR-UN SEMNAL PE CARE ÎL SCRIE ORICINE.
 *    Prima versiune a punții spunea „obiectul există ⇒ suntem în Telegram" și
 *    pagina ieșea albă. Corectarea a mutat verificarea pe `platform !== 'unknown'`
 *    — mai bine, dar tot o afirmație a paginii despre ea însăși: programul
 *    `telegram-web-app.js` își citește `platform`, `version`, `initData` și
 *    `themeParams` din FRAGMENTUL adresei (`#tgWebAppPlatform=…`), iar
 *    fragmentul îl compune cine deschide adresa. Cu `#tgWebAppPlatform=ios`
 *    într-un Chrome obișnuit, poarta se deschidea, schema „deschis" implicită
 *    era preluată și pagina redevenea ALBĂ.
 *
 *    Reparația nu ghicește mediul mai bine: leagă decizia de DATELE de care
 *    depinde. Modul deschis se acceptă doar dacă am primit și culorile cu care
 *    să-l desenăm.
 *
 * 2. ÎNREGISTRARE PE JUMĂTATE, EȘEC ÎNGHIȚIT.
 *    `showMainButton` / `showBackButton` legau handlerul ÎNAINTE de apelurile
 *    care pot pica, iar pe eșec întorceau o curățare care nu curăța nimic.
 */
import { describe, expect, it, vi } from 'vitest';

import { installTelegramStub } from '@/test/telegramStub';

import { getColorScheme, isInsideTelegram, showBackButton, showMainButton } from '../bridge';

/** `themeParams` ale unui client Telegram real pe temă deschisă. */
const REAL_LIGHT_PARAMS = {
  bg_color: '#ffffff',
  text_color: '#000000',
  hint_color: '#707579',
  link_color: '#3390ec',
};

describe('schema de culori nu se ia pe cuvânt', () => {
  it('„deschis" fără culorile clientului rămâne tema închisă a produsului', () => {
    // Exact starea produsă de `https://<miniapp>/#tgWebAppPlatform=ios`
    // deschis în Chrome: platformă credibilă, schemă „deschis" implicită,
    // NICIUN parametru de temă. Înainte, asta scria paleta deschisă peste tema
    // produsului și pagina ieșea albă.
    installTelegramStub({ platform: 'ios', colorScheme: 'light', themeParams: {} });

    expect(isInsideTelegram()).toBe(true); // poarta de platformă chiar se deschide
    expect(getColorScheme()).toBe('dark'); // …dar tema nu se schimbă fără date
  });

  it('„deschis" cu paleta clientului chiar trece pe deschis', () => {
    // Perechea testului de mai sus: un client real pe temă deschisă trimite
    // MEREU `bg_color`/`text_color`. Fără acest test, cineva ar putea „întări"
    // verificarea până la „niciodată deschis" și ar strica modul deschis real.
    installTelegramStub({ colorScheme: 'light', themeParams: REAL_LIGHT_PARAMS });

    expect(getColorScheme()).toBe('light');
  });

  it('un singur parametru de culoare valid e de ajuns', () => {
    installTelegramStub({ colorScheme: 'light', themeParams: { bg_color: '#FFF' } });

    expect(getColorScheme()).toBe('light');
  });

  it('parametri prezenți dar nefolosibili nu deschid tema', () => {
    // Valori care nu sunt culori: nimic nu ar ajusta paleta, deci „deschis" ar
    // însemna iar pagină albă nestilizată.
    installTelegramStub({
      colorScheme: 'light',
      themeParams: { bg_color: '', text_color: 'rgb(1,2,3)' } as never,
    });

    expect(getColorScheme()).toBe('dark');
  });

  it('clientul pe temă închisă rămâne închis, cu sau fără parametri', () => {
    installTelegramStub({ colorScheme: 'dark', themeParams: { bg_color: '#17212b' } });
    expect(getColorScheme()).toBe('dark');
  });
});

describe('butoanele native nu rămân legate după un eșec', () => {
  it('`showMainButton`: dacă `show()` pică, handlerul e desfăcut', () => {
    // Scenariul: un client mai vechi acceptă `setText`/`onClick`, apoi refuză
    // `show()`. Handlerul e DEJA înregistrat. Înainte, apelantul primea un
    // no-op drept curățare, deci la părăsirea ecranului handlerul supraviețuia:
    // o apăsare pe butonul principal executa trimiterea ecranului precedent
    // (în formularul de profil — un `PUT /profiles/me` cu un draft vechi).
    const stub = installTelegramStub();
    const main = stub.webApp.MainButton as unknown as {
      show: ReturnType<typeof vi.fn>;
      onClick: ReturnType<typeof vi.fn>;
      offClick: ReturnType<typeof vi.fn>;
    };
    main.show.mockImplementation(() => {
      throw new Error('clientul nu cunoaște metoda');
    });

    const onClick = vi.fn();
    showMainButton({ text: 'Salvează', onClick });

    expect(main.onClick).toHaveBeenCalledWith(onClick);
    expect(main.offClick).toHaveBeenCalledWith(onClick);
  });

  it('`showBackButton`: dacă `show()` pică, handlerul e desfăcut', () => {
    const stub = installTelegramStub();
    const back = stub.webApp.BackButton as unknown as {
      show: ReturnType<typeof vi.fn>;
      onClick: ReturnType<typeof vi.fn>;
      offClick: ReturnType<typeof vi.fn>;
    };
    back.show.mockImplementation(() => {
      throw new Error('clientul nu cunoaște metoda');
    });

    const onBack = vi.fn();
    showBackButton(onBack);

    expect(back.onClick).toHaveBeenCalledWith(onBack);
    expect(back.offClick).toHaveBeenCalledWith(onBack);
  });

  it('pe drumul normal butonul NU e desfăcut la înregistrare', () => {
    const stub = installTelegramStub();
    const main = stub.webApp.MainButton as unknown as {
      offClick: ReturnType<typeof vi.fn>;
    };

    const cleanup = showMainButton({ text: 'Salvează', onClick: vi.fn() });

    expect(main.offClick).not.toHaveBeenCalled();
    cleanup();
    expect(main.offClick).toHaveBeenCalled();
  });
});
