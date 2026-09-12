/**
 * Ecranele de stare — exact defectul raportat de proprietar.
 *
 * El a deschis `https://miniapp.flrt.md` în Chrome, în afara Telegram, și a
 * primit o pagină albă cu o propoziție și NICIUN buton. Testele de aici apără
 * cele trei lucruri care lipseau: logoul, tema produsului și butonul care duce
 * înapoi în Telegram — plus regula că butonul NU apare dacă numele botului nu e
 * configurat la build (mai bine niciun buton decât unul care duce nicăieri).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/api/client';
import { useAuthStore } from '@/auth/authStore';
import { App, errorActions } from '@/App';
import { StatusScreen } from '@/components/StatusScreen';
import { botChatUrl, resolveBotUsername } from '@/config';
import { telegramBotAction } from '@/telegram/botLink';
import { renderWithProviders } from '@/test/harness';
import { installTelegramStub } from '@/test/telegramStub';

const BOT = 'flirt_md_bot';

function withBot(username: string | undefined) {
  if (username === undefined) vi.stubEnv('VITE_TELEGRAM_BOT_USERNAME', '');
  else vi.stubEnv('VITE_TELEGRAM_BOT_USERNAME', username);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

/* ————————————————————————— numele botului ————————————————————————— */

describe('numele botului din mediu', () => {
  it('acceptă un nume simplu', () => {
    expect(resolveBotUsername(BOT)).toBe(BOT);
  });

  it('tolerează formele pe care le scrie un om în `.env`', () => {
    expect(resolveBotUsername(` @${BOT} `)).toBe(BOT);
    expect(resolveBotUsername(`https://t.me/${BOT}`)).toBe(BOT);
    expect(resolveBotUsername(`https://telegram.me/${BOT}/`)).toBe(BOT);
  });

  it('refuză ce nu e un nume de bot', () => {
    for (const bad of [undefined, null, '', '   ', '@', 'ab', '1bot', 'bot name', 'bot-name']) {
      expect(resolveBotUsername(bad)).toBeNull();
    }
  });

  it('construiește adresa chatului, sau nimic', () => {
    expect(botChatUrl(BOT)).toBe(`https://t.me/${BOT}`);
    expect(botChatUrl(null)).toBeNull();
  });
});

/* ——————————————————————— acțiunea către Telegram ——————————————————— */

describe('acțiunea „Deschide în Telegram"', () => {
  it('LIPSEȘTE când numele botului nu e configurat la build', () => {
    withBot(undefined);
    expect(telegramBotAction({ label: 'Deschide în Telegram' })).toBeNull();
  });

  it('LIPSEȘTE și când variabila conține o valoare invalidă', () => {
    withBot('nu e un nume');
    expect(telegramBotAction({ label: 'Deschide în Telegram' })).toBeNull();
  });

  it('duce la chatul botului când e configurat', () => {
    withBot(BOT);
    expect(telegramBotAction({ label: 'x' })?.href).toBe(`https://t.me/${BOT}`);
  });

  it('se randează ca LEGĂTURĂ reală, nu ca buton cu window.open', () => {
    withBot(BOT);
    const action = telegramBotAction({ label: 'Deschide în Telegram' });
    render(<StatusScreen title="t" actions={action ? [action] : []} />);

    const link = screen.getByTestId('open-in-telegram');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', `https://t.me/${BOT}`);
  });

  it('în afara Telegram lasă browserul să navigheze singur', async () => {
    withBot(BOT);
    const action = telegramBotAction({ label: 'Deschide în Telegram' });
    render(<StatusScreen title="t" actions={action ? [action] : []} />);

    const link = screen.getByTestId('open-in-telegram') as HTMLAnchorElement;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);

    // Nimic nu a oprit navigarea: fără client Telegram, `<a href>` e tot ce avem.
    expect(event.defaultPrevented).toBe(false);
  });

  it('în interiorul Telegram sare direct în chat, fără browser', async () => {
    withBot(BOT);
    const openTelegramLink = vi.fn();
    installTelegramStub({ openTelegramLink } as never);

    const action = telegramBotAction({ label: 'Deschide în Telegram' });
    render(<StatusScreen title="t" actions={action ? [action] : []} />);

    const link = screen.getByTestId('open-in-telegram');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);

    expect(openTelegramLink).toHaveBeenCalledWith(`https://t.me/${BOT}`);
    expect(event.defaultPrevented).toBe(true);
  });

  it('pe un client vechi cade pe `openLink`', () => {
    withBot(BOT);
    const openLink = vi.fn();
    installTelegramStub({ openLink } as never);

    const action = telegramBotAction({ label: 'x' });
    render(<StatusScreen title="t" actions={action ? [action] : []} />);
    screen.getByTestId('open-in-telegram').dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    expect(openLink).toHaveBeenCalledWith(`https://t.me/${BOT}`);
  });
});

/* ————————————————————— componentul de ecran ————————————————————— */

describe('StatusScreen', () => {
  it('arată logoul: ecranul trebuie să semene a produs, nu a eroare de browser', () => {
    render(<StatusScreen title="Titlu" body="Explicație" />);

    expect(screen.getByTestId('brand-logo')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Titlu' })).toBeInTheDocument();
    expect(screen.getByText('Explicație')).toBeInTheDocument();
  });

  it('logoul are dimensiuni scrise, ca textul să nu sară la încărcare', () => {
    render(<StatusScreen title="Titlu" />);
    const logo = screen.getByTestId('brand-logo');
    expect(logo).toHaveAttribute('width');
    expect(logo).toHaveAttribute('height');
  });

  it('poate renunța la logo în ecranele dinăuntrul aplicației', () => {
    render(<StatusScreen title="Titlu" logo={false} />);
    expect(screen.queryByTestId('brand-logo')).not.toBeInTheDocument();
  });

  it('starea de încărcare are rotița anunțată, nu un al doilea titlu de nivel 1', () => {
    render(<StatusScreen loading title="Te conectăm…" />);

    expect(screen.getByRole('status', { name: 'Te conectăm…' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('leagă acțiunile și marchează acțiunea secundară', async () => {
    const onClick = vi.fn();
    render(
      <StatusScreen
        title="t"
        actions={[
          { label: 'Principal', onClick, testId: 'a1' },
          { label: 'Secundar', onClick, ghost: true, testId: 'a2' },
        ]}
      />,
    );

    await userEvent.click(screen.getByTestId('a1'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('a1')).not.toHaveClass('button--ghost');
    expect(screen.getByTestId('a2')).toHaveClass('button--ghost');
  });
});

/* ——————————————————— acțiunile fiecărei stări ——————————————————— */

describe('acțiunile stărilor de autentificare', () => {
  const labels = { retry: 'Încearcă din nou', openTelegram: 'Deschide în Telegram' };

  it('„în afara Telegram": DOAR butonul spre Telegram, fără reîncercare', () => {
    withBot(BOT);
    const actions = errorActions('outside_telegram', labels, vi.fn());

    expect(actions).toHaveLength(1);
    expect(actions[0]?.href).toBe(`https://t.me/${BOT}`);
    // O reîncercare acolo ar eșua garantat: fără SDK nu există `initData`.
    expect(actions.some((a) => a.testId === 'auth-retry')).toBe(false);
  });

  it('„în afara Telegram" fără bot configurat: niciun buton mort', () => {
    withBot(undefined);
    expect(errorActions('outside_telegram', labels, vi.fn())).toHaveLength(0);
  });

  it('date expirate sau invalide: reîncercare + Telegram ca acțiune secundară', () => {
    withBot(BOT);
    for (const kind of ['expired', 'invalid'] as const) {
      const actions = errorActions(kind, labels, vi.fn());
      expect(actions[0]?.testId).toBe('auth-retry');
      expect(actions[1]?.href).toBe(`https://t.me/${BOT}`);
      expect(actions[1]?.ghost).toBe(true);
    }
  });

  it('rețea sau server: doar reîncercarea — Telegram nu rezolvă nimic acolo', () => {
    withBot(BOT);
    for (const kind of ['network', 'server'] as const) {
      const actions = errorActions(kind, labels, vi.fn());
      expect(actions).toHaveLength(1);
      expect(actions[0]?.testId).toBe('auth-retry');
    }
  });

  it('reîncercarea chiar cheamă autentificarea', async () => {
    withBot(BOT);
    const retry = vi.fn();
    const actions = errorActions('network', labels, retry);
    render(<StatusScreen title="t" actions={actions} />);

    await userEvent.click(screen.getByTestId('auth-retry'));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe('fiecare stare arată a produs și are o ieșire', () => {
  const labels = { retry: 'Încearcă din nou', openTelegram: 'Deschide în Telegram' };
  const KINDS = ['outside_telegram', 'expired', 'invalid', 'network', 'server'] as const;

  it.each(KINDS)('starea „%s": logo, titlu, explicație și cel puțin o acțiune', (kind) => {
    withBot(BOT);
    const { unmount } = render(
      <StatusScreen
        title={`titlu ${kind}`}
        body={`explicație ${kind}`}
        actions={errorActions(kind, labels, vi.fn())}
      />,
    );

    expect(screen.getByTestId('brand-logo')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: `titlu ${kind}` })).toBeInTheDocument();
    expect(screen.getByText(`explicație ${kind}`)).toBeInTheDocument();
    // Regula: niciun ecran fără ieșire.
    expect(screen.getAllByRole(kind === 'outside_telegram' ? 'link' : 'button').length)
      .toBeGreaterThan(0);
    unmount();
  });

  it('starea „se încarcă" păstrează logoul și anunță așteptarea', () => {
    render(<StatusScreen loading title="Te conectăm…" body="Durează o clipă." />);

    expect(screen.getByTestId('brand-logo')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('feed gol: logo, titlu și o acțiune — nu e o eroare', () => {
    render(
      <StatusScreen
        title="Nu mai sunt ankete acum"
        body="Revino mai târziu."
        actions={[{ label: 'Caută mai multe', onClick: vi.fn(), testId: 'deck-reload' }]}
      />,
    );

    expect(screen.getByTestId('brand-logo')).toBeInTheDocument();
    expect(screen.getByTestId('deck-reload')).toBeInTheDocument();
  });
});

/* —————————————————— aplicația, capăt la capăt —————————————————— */

describe('aplicația deschisă în afara Telegram', () => {
  beforeEach(() => {
    useAuthStore.setState({ status: 'idle', user: null, error: null, optimisticName: null });
  });

  it('arată logo, explicație și butonul spre bot — nu o pagină albă cu text', async () => {
    withBot(BOT);
    // Fără `window.Telegram` (setup-ul îl șterge înaintea fiecărui test):
    // exact ce se întâmplă la deschiderea adresei în Chrome.
    const post = vi.spyOn(api, 'post');

    renderWithProviders(<App />);

    const screenRoot = await screen.findByTestId('status-outside_telegram');
    expect(screenRoot).toBeInTheDocument();
    expect(screen.getByTestId('brand-logo')).toBeInTheDocument();
    expect(screen.getByTestId('open-in-telegram')).toHaveAttribute(
      'href',
      `https://t.me/${BOT}`,
    );
    // Nu s-a atins serverul: nu avem ce trimite fără `initData`.
    expect(post).not.toHaveBeenCalled();
  });

  it('fără bot configurat rămâne explicația, dar fără buton rupt', async () => {
    withBot(undefined);
    renderWithProviders(<App />);

    expect(await screen.findByTestId('status-outside_telegram')).toBeInTheDocument();
    expect(screen.queryByTestId('open-in-telegram')).not.toBeInTheDocument();
  });
});
