/**
 * Secțiunea „Notificări în Telegram": starea de pe server, comutare optimistă
 * cu revenire la eroare, blocare cât salvează, și ascundere pe server vechi (404).
 * Izolăm doar clientul HTTP.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

const { api } = await import('@/api/client');
const { renderWithProviders } = await import('@/test/harness');
const { TelegramNotificationsSection } = await import('../TelegramNotificationsSection');

const ALL_ON = { messages: true, likes: true, stories: true, matches: true };

function httpError(status: number): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('fail', String(status), config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data: {},
  });
}

/** Promisiune controlată din test, ca să vedem starea „în zbor". */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.put).mockReset();
});

describe('încărcarea', () => {
  it('arată cele patru comutatoare cu starea de pe server', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { ...ALL_ON, stories: false } });
    renderWithProviders(<TelegramNotificationsSection />);

    expect(await screen.findByTestId('tg-notif-messages')).toBeChecked();
    expect(screen.getByTestId('tg-notif-likes')).toBeChecked();
    expect(screen.getByTestId('tg-notif-stories')).not.toBeChecked();
    expect(screen.getByTestId('tg-notif-matches')).toBeChecked();
    expect(screen.getByText('Notificări în Telegram')).toBeInTheDocument();
    expect(screen.getByText('Like-uri și super like-uri')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/notifications/telegram');
  });

  it('arată rotița cât timp întreabă serverul', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => undefined));
    renderWithProviders(<TelegramNotificationsSection />);
    expect(screen.getByTestId('telegram-notifications-loading')).toBeInTheDocument();
  });

  it('server vechi (404) → secțiunea nu apare deloc, fără reîncercări', async () => {
    vi.mocked(api.get).mockRejectedValue(httpError(404));
    const { container } = renderWithProviders(<TelegramNotificationsSection />);

    await waitFor(() =>
      expect(screen.queryByTestId('telegram-notifications-section')).not.toBeInTheDocument(),
    );
    expect(container).toBeEmptyDOMElement();
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('altă eroare → mesaj în secțiune și buton de reîncercare', async () => {
    vi.mocked(api.get).mockRejectedValue(httpError(500));
    renderWithProviders(<TelegramNotificationsSection />);

    expect(
      await screen.findByTestId('telegram-notifications-load-error', {}, { timeout: 4000 }),
    ).toBeInTheDocument();

    vi.mocked(api.get).mockResolvedValue({ data: ALL_ON });
    await userEvent.click(screen.getByTestId('telegram-notifications-retry'));
    expect(await screen.findByTestId('tg-notif-messages')).toBeChecked();
  });
});

describe('salvarea', () => {
  it('e optimistă, trimite DOAR câmpul schimbat și blochează comutatoarele cât salvează', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: ALL_ON });
    const put = deferred<{ data: typeof ALL_ON }>();
    vi.mocked(api.put).mockReturnValue(put.promise);
    renderWithProviders(<TelegramNotificationsSection />);

    await userEvent.click(await screen.findByTestId('tg-notif-likes'));

    // Imediat, înainte de răspuns: comutatorul s-a mutat, toate sunt blocate.
    expect(screen.getByTestId('tg-notif-likes')).not.toBeChecked();
    expect(screen.getByTestId('tg-notif-messages')).toBeDisabled();
    expect(screen.getByTestId('tg-notif-likes')).toBeDisabled();
    expect(api.put).toHaveBeenCalledWith('/notifications/telegram', { likes: false });

    put.resolve({ data: { ...ALL_ON, likes: false } });
    await waitFor(() => expect(screen.getByTestId('tg-notif-likes')).toBeEnabled());
    expect(screen.getByTestId('tg-notif-likes')).not.toBeChecked();
    expect(screen.queryByTestId('telegram-notifications-save-error')).not.toBeInTheDocument();
  });

  it('la eroare revine la valoarea anterioară și spune asta', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: ALL_ON });
    const put = deferred<never>();
    vi.mocked(api.put).mockReturnValue(put.promise);
    renderWithProviders(<TelegramNotificationsSection />);

    await userEvent.click(await screen.findByTestId('tg-notif-stories'));
    expect(screen.getByTestId('tg-notif-stories')).not.toBeChecked();

    put.reject(httpError(500));
    await waitFor(() => expect(screen.getByTestId('tg-notif-stories')).toBeChecked());
    expect(screen.getByTestId('telegram-notifications-save-error')).toBeInTheDocument();
    expect(screen.getByTestId('tg-notif-stories')).toBeEnabled();
  });

  it('afișează valoarea CONFIRMATĂ de server, nu pe cea cerută', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: ALL_ON });
    vi.mocked(api.put).mockResolvedValue({ data: { ...ALL_ON, matches: true } });
    renderWithProviders(<TelegramNotificationsSection />);

    await userEvent.click(await screen.findByTestId('tg-notif-matches'));
    await waitFor(() => expect(screen.getByTestId('tg-notif-matches')).toBeEnabled());
    expect(screen.getByTestId('tg-notif-matches')).toBeChecked();
  });
});
