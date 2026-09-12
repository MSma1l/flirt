/**
 * Comutatorul de activare: reflectă starea de pe SERVER, o salvează pe ruta de
 * setări cu câmpul `ai_enabled`, și e OPRIT când serverul nu spune altfel.
 *
 * Izolăm doar clientul HTTP: maparea câmpului, forma payload-ului parțial și
 * stările ecranului rulează real.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

const { api } = await import('@/api/client');
const { renderWithProviders } = await import('@/test/harness');
const { AiSettingsSection } = await import('../AiSettingsSection');

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.put).mockReset();
});

describe('starea de pe server', () => {
  it('arată comutatorul OPRIT când serverul spune `ai_enabled: false`', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { ai_enabled: false } });
    renderWithProviders(<AiSettingsSection />);

    await waitFor(() => expect(screen.getByTestId('ai-enabled')).not.toBeChecked());
    expect(api.get).toHaveBeenCalledWith('/settings/');
  });

  it('arată comutatorul PORNIT când serverul spune `ai_enabled: true`', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { ai_enabled: true } });
    renderWithProviders(<AiSettingsSection />);

    await waitFor(() => expect(screen.getByTestId('ai-enabled')).toBeChecked());
  });

  it('rămâne OPRIT dacă răspunsul nu conține deloc câmpul', async () => {
    // Cont nou, client vechi, câmp lipsă: orice ambiguitate se citește „oprit".
    // Funcția trimite fragmente de conversație în afară — presupunerea inversă
    // ar face exact ce utilizatorul nu a cerut.
    vi.mocked(api.get).mockResolvedValue({ data: {} });
    renderWithProviders(<AiSettingsSection />);

    await waitFor(() => expect(screen.getByTestId('ai-enabled')).not.toBeChecked());
  });

  it('arată rotița cât timp întreabă serverul', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => undefined));
    renderWithProviders(<AiSettingsSection />);

    expect(screen.getByTestId('ai-settings-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-enabled')).not.toBeInTheDocument();
  });
});

describe('explicația de lângă comutator', () => {
  it('spune explicit că mesajele ajung la un serviciu extern', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { ai_enabled: false } });
    renderWithProviders(<AiSettingsSection />);

    await screen.findByTestId('ai-enabled');
    const consent = screen.getByTestId('ai-consent');
    expect(consent).toHaveTextContent(/serviciu extern/i);
    expect(consent).toHaveTextContent(/ultimele mesaje/i);
    // Nu e ascunsă în subsol: stă în secțiune, înaintea comutatorului.
    expect(consent.compareDocumentPosition(screen.getByTestId('ai-enabled')))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

describe('salvarea', () => {
  it('trimite DOAR `ai_enabled` prin PUT /settings/ și arată starea confirmată', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { ai_enabled: false } });
    vi.mocked(api.put).mockResolvedValue({ data: { ai_enabled: true } });
    renderWithProviders(<AiSettingsSection />);

    await userEvent.click(await screen.findByTestId('ai-enabled'));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/settings/', { ai_enabled: true }),
    );
    await waitFor(() => expect(screen.getByTestId('ai-enabled')).toBeChecked());
  });

  it('stinge funcția la a doua apăsare', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { ai_enabled: true } });
    vi.mocked(api.put).mockResolvedValue({ data: { ai_enabled: false } });
    renderWithProviders(<AiSettingsSection />);

    await waitFor(() => expect(screen.getByTestId('ai-enabled')).toBeChecked());
    await userEvent.click(screen.getByTestId('ai-enabled'));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/settings/', { ai_enabled: false }),
    );
    await waitFor(() => expect(screen.getByTestId('ai-enabled')).not.toBeChecked());
  });

  it('urmează serverul, nu clicul: dacă răspunsul spune „oprit", comutatorul rămâne oprit', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { ai_enabled: false } });
    // Serverul a refuzat tăcut aprinderea (de exemplu `ai_provider = 'stub'`).
    vi.mocked(api.put).mockResolvedValue({ data: { ai_enabled: false } });
    renderWithProviders(<AiSettingsSection />);

    await userEvent.click(await screen.findByTestId('ai-enabled'));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(screen.getByTestId('ai-enabled')).not.toBeChecked();
  });

  it('arată o eroare discretă când salvarea eșuează', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { ai_enabled: false } });
    vi.mocked(api.put).mockRejectedValue(new Error('500'));
    renderWithProviders(<AiSettingsSection />);

    await userEvent.click(await screen.findByTestId('ai-enabled'));

    expect(await screen.findByTestId('ai-settings-save-error')).toBeInTheDocument();
  });
});

describe('eroarea de încărcare', () => {
  it('rămâne în interiorul secțiunii și se poate reîncerca', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    vi.mocked(api.get).mockResolvedValue({ data: { ai_enabled: true } });
    renderWithProviders(<AiSettingsSection />);

    await userEvent.click(await screen.findByTestId('ai-settings-retry'));

    await waitFor(() => expect(screen.getByTestId('ai-enabled')).toBeChecked());
  });
});
