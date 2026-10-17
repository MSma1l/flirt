/**
 * Invitația „Vrei să te anunțăm în Telegram?": apare doar când botul NU are
 * voie să scrie și clientul poate cere (6.9+), o singură dată, fără insistență.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/harness';
import { installTelegramStub } from '@/test/telegramStub';
import type { TelegramWebApp } from '@/telegram/types';

import { WriteAccessCard } from '../WriteAccessCard';
import { resetWriteAccessMemory } from '../writeAccess';

function stub({
  allowed = false,
  version = '8.0',
  answer = true,
  withMethod = true,
}: { allowed?: boolean; version?: string; answer?: boolean; withMethod?: boolean } = {}) {
  const requestWriteAccess = vi.fn((cb?: (ok: boolean) => void) => cb?.(answer));
  installTelegramStub({
    version,
    initDataUnsafe: {
      user: { id: 1, first_name: 'Ana', ...(allowed ? { allows_write_to_pm: true } : {}) },
    },
    ...(withMethod ? { requestWriteAccess } : {}),
  } as Partial<TelegramWebApp>);
  return requestWriteAccess;
}

beforeEach(() => {
  window.localStorage.clear();
  resetWriteAccessMemory();
});

afterEach(() => {
  delete (window as { Telegram?: unknown }).Telegram;
});

describe('când apare', () => {
  it('apare când botul nu are voie să scrie', () => {
    stub();
    renderWithProviders(<WriteAccessCard slot="chats" />);
    expect(screen.getByTestId('write-access-chats')).toHaveTextContent(
      'Vrei să te anunțăm în Telegram când cineva îți scrie?',
    );
  });

  it('NU apare când botul are deja voie (`allows_write_to_pm`)', () => {
    stub({ allowed: true });
    renderWithProviders(<WriteAccessCard slot="chats" />);
    expect(screen.queryByTestId('write-access-chats')).not.toBeInTheDocument();
  });

  it('NU apare pe un client mai vechi de 6.9 sau fără metodă', () => {
    stub({ version: '6.8' });
    const { unmount } = renderWithProviders(<WriteAccessCard slot="chats" />);
    expect(screen.queryByTestId('write-access-chats')).not.toBeInTheDocument();
    unmount();

    stub({ withMethod: false });
    renderWithProviders(<WriteAccessCard slot="settings" />);
    expect(screen.queryByTestId('write-access-settings')).not.toBeInTheDocument();
  });

  it('NU apare în afara Telegram', () => {
    renderWithProviders(<WriteAccessCard slot="chats" />);
    expect(screen.queryByTestId('write-access-chats')).not.toBeInTheDocument();
  });
});

describe('o singură dată', () => {
  it('„Da" cere permisiunea nativă, apoi nu mai apare nicăieri', async () => {
    const request = stub({ answer: true });
    const { unmount } = renderWithProviders(<WriteAccessCard slot="chats" />);

    await userEvent.click(screen.getByTestId('write-access-chats-allow'));
    expect(request).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('write-access-chats')).not.toBeInTheDocument());
    unmount();

    // Nici în Setări, nici la o nouă sesiune (memoria modulului golită).
    resetWriteAccessMemory();
    renderWithProviders(
      <>
        <WriteAccessCard slot="chats" />
        <WriteAccessCard slot="settings" />
      </>,
    );
    expect(screen.queryByTestId('write-access-chats')).not.toBeInTheDocument();
    expect(screen.queryByTestId('write-access-settings')).not.toBeInTheDocument();
  });

  it('„Nu acum" o închide și nu mai revine', async () => {
    stub();
    const { unmount } = renderWithProviders(<WriteAccessCard slot="chats" />);
    await userEvent.click(screen.getByTestId('write-access-chats-later'));
    expect(screen.queryByTestId('write-access-chats')).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<WriteAccessCard slot="chats" />);
    expect(screen.queryByTestId('write-access-chats')).not.toBeInTheDocument();
  });

  it('invitația din conversații ignorată nu revine într-o sesiune nouă', () => {
    stub();
    const first = renderWithProviders(<WriteAccessCard slot="chats" />);
    expect(screen.getByTestId('write-access-chats')).toBeInTheDocument();
    first.unmount();

    // Aceeași sesiune (schimbare de tab): rămâne, nu „clipește".
    const again = renderWithProviders(<WriteAccessCard slot="chats" />);
    expect(screen.getByTestId('write-access-chats')).toBeInTheDocument();
    again.unmount();

    // Sesiune nouă: deja văzută → nu mai apare.
    resetWriteAccessMemory();
    renderWithProviders(<WriteAccessCard slot="chats" />);
    expect(screen.queryByTestId('write-access-chats')).not.toBeInTheDocument();
  });

  it('refuzul din fereastra nativă închide și el invitația', async () => {
    stub({ answer: false });
    const { unmount } = renderWithProviders(<WriteAccessCard slot="settings" />);
    await userEvent.click(screen.getByTestId('write-access-settings-allow'));
    await waitFor(() =>
      expect(screen.queryByTestId('write-access-settings')).not.toBeInTheDocument(),
    );
    unmount();

    renderWithProviders(<WriteAccessCard slot="settings" />);
    expect(screen.queryByTestId('write-access-settings')).not.toBeInTheDocument();
  });

  it('merge și fără localStorage (WebView cu stocarea blocată)', async () => {
    stub();
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      const { unmount } = renderWithProviders(<WriteAccessCard slot="chats" />);
      await userEvent.click(screen.getByTestId('write-access-chats-later'));
      unmount();
      renderWithProviders(<WriteAccessCard slot="chats" />);
      expect(screen.queryByTestId('write-access-chats')).not.toBeInTheDocument();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});
