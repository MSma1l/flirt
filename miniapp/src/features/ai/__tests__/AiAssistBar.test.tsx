/**
 * Bara AI din conversație.
 *
 * Cele două reguli de produs verificate aici, nu doar afișate:
 *  1. când funcția e OPRITĂ nu apare nimic ȘI nu pleacă nicio cerere spre `/ai`;
 *  2. o sugestie ajunge DOAR în câmpul de scriere — componentul nici măcar nu
 *     are o cale spre trimitere (primește `onInsert`, nu `onSend`).
 *
 * Plus fiecare stare de eroare, cu textul ei și cu butonul de reîncercare doar
 * acolo unde reîncercarea are sens.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../aiApi', () => ({
  fetchChatHint: vi.fn(),
  fetchChemistry: vi.fn(),
}));

const aiEnabled = { value: true };
vi.mock('../aiSettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../aiSettings')>()),
  useAiEnabled: () => ({
    enabled: aiEnabled.value,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

const { fetchChatHint, fetchChemistry } = await import('../aiApi');
const { AiError } = await import('../aiErrors');
const { renderWithProviders } = await import('@/test/harness');
const { AiAssistBar } = await import('../AiAssistBar');

const SUGGESTIONS = ['Ce faci diseară?', 'Ai încercat vreodată să faci parapantă?'];

function renderBar(onInsert = vi.fn(), otherUserId = 'u1') {
  renderWithProviders(
    <AiAssistBar chatId="c1" otherUserId={otherUserId} onInsert={onInsert} />,
  );
  return onInsert;
}

beforeEach(() => {
  aiEnabled.value = true;
  vi.mocked(fetchChatHint).mockReset();
  vi.mocked(fetchChemistry).mockReset();
  vi.mocked(fetchChatHint).mockResolvedValue({ suggestions: SUGGESTIONS, cached: false });
  vi.mocked(fetchChemistry).mockResolvedValue({
    score: 78,
    explanation: 'Amândoi glumiți la fel.',
    unavailable: null,
  });
});

describe('poarta de activare', () => {
  it('nu randează NIMIC și nu cheamă AI-ul când funcția e oprită', async () => {
    aiEnabled.value = false;
    renderBar();

    expect(screen.queryByTestId('ai-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-suggest')).not.toBeInTheDocument();
    // Nici la montare, nici după ce se așază efectele.
    await waitFor(() => expect(fetchChatHint).not.toHaveBeenCalled());
    expect(fetchChemistry).not.toHaveBeenCalled();
  });

  it('arată butoanele când funcția e pornită, dar nu cere nimic de la sine', async () => {
    renderBar();

    expect(await screen.findByTestId('ai-suggest')).toBeInTheDocument();
    expect(screen.getByTestId('ai-chemistry-open')).toBeInTheDocument();
    // Cererile costă bani la furnizor: pleacă doar la apăsarea utilizatorului.
    expect(fetchChatHint).not.toHaveBeenCalled();
    expect(fetchChemistry).not.toHaveBeenCalled();
  });
});

describe('sugestiile', () => {
  it('cere sugestiile la apăsare și le arată pe toate', async () => {
    renderBar();
    await userEvent.click(screen.getByTestId('ai-suggest'));

    await waitFor(() => expect(fetchChatHint).toHaveBeenCalledWith('c1'));
    expect(await screen.findByTestId('ai-suggestion-text-0')).toHaveTextContent(SUGGESTIONS[0]!);
    expect(screen.getByTestId('ai-suggestion-text-1')).toHaveTextContent(SUGGESTIONS[1]!);
  });

  it('pune varianta aleasă în câmp — și ATÂT', async () => {
    const onInsert = renderBar();
    await userEvent.click(screen.getByTestId('ai-suggest'));
    await screen.findByTestId('ai-suggestion-insert-1');

    await userEvent.click(screen.getByTestId('ai-suggestion-insert-1'));

    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert).toHaveBeenCalledWith(SUGGESTIONS[1]);
    // Panoul se închide: sugestia și-a făcut treaba, textul e în composer.
    expect(screen.queryByTestId('ai-suggestion-panel')).not.toBeInTheDocument();
  });

  it('„alte variante" cere din nou, nu refolosește răspunsul vechi', async () => {
    renderBar();
    await userEvent.click(screen.getByTestId('ai-suggest'));
    await screen.findByTestId('ai-suggestion-again');

    vi.mocked(fetchChatHint).mockResolvedValue({ suggestions: ['Altceva?'], cached: false });
    await userEvent.click(screen.getByTestId('ai-suggestion-again'));

    await waitFor(() => expect(fetchChatHint).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('ai-suggestion-text-0')).toHaveTextContent('Altceva?');
  });

  it('închiderea panoului nu inserează nimic', async () => {
    const onInsert = renderBar();
    await userEvent.click(screen.getByTestId('ai-suggest'));
    await screen.findByTestId('ai-suggestion-close');

    await userEvent.click(screen.getByTestId('ai-suggestion-close'));

    expect(screen.queryByTestId('ai-suggestion-panel')).not.toBeInTheDocument();
    expect(onInsert).not.toHaveBeenCalled();
  });

  it('arată o stare de încărcare cât timp serviciul scrie', async () => {
    vi.mocked(fetchChatHint).mockReturnValue(new Promise(() => undefined));
    renderBar();

    await userEvent.click(screen.getByTestId('ai-suggest'));

    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.getByTestId('ai-suggest')).toBeDisabled();
  });
});

describe('stările de eroare', () => {
  it.each([
    ['disabled', 'Asistentul AI e oprit. Îl poți porni din Setări.', false],
    [
      'not_configured',
      'Asistentul AI nu e disponibil pe server acum. Nu e ceva ce poți repara tu — încearcă mai târziu.',
      false,
    ],
    [
      'no_history',
      'Conversația e încă prea scurtă ca să avem de unde porni. Scrie câteva mesaje și revino.',
      false,
    ],
    ['not_found', 'Conversația sau profilul nu mai sunt disponibile.', false],
    [
      'rate_limit',
      'Prea multe cereri într-un timp scurt. Așteaptă un minut și încearcă din nou.',
      true,
    ],
    [
      'provider',
      'Serviciul de inteligență artificială nu a răspuns. Încearcă peste câteva momente.',
      true,
    ],
    [
      'network',
      'Nu avem legătură cu serverul. Verifică internetul și încearcă din nou.',
      true,
    ],
    ['unknown', 'Nu am putut obține un răspuns. Încearcă din nou.', true],
  ])('„%s" are text propriu, nu „a apărut o eroare"', async (kind, text, retryable) => {
    vi.mocked(fetchChatHint).mockRejectedValue(
      new AiError(kind as InstanceType<typeof AiError>['kind']),
    );
    renderBar();

    await userEvent.click(screen.getByTestId('ai-suggest'));

    const box = await screen.findByTestId('ai-suggestion-error');
    expect(box).toHaveTextContent(text);
    expect(box).toHaveAttribute('data-kind', kind);
    // Reîncercarea apare DOAR unde are șanse să schimbe ceva.
    expect(!!screen.queryByTestId('ai-suggestion-error-retry')).toBe(retryable);
    // Eroare discretă, în panou — nu un ecran plin peste conversație.
    expect(screen.getByTestId('ai-bar')).toContainElement(box);
  });

  it('reîncercarea chiar cere din nou', async () => {
    vi.mocked(fetchChatHint).mockRejectedValueOnce(new AiError('provider'));
    renderBar();
    await userEvent.click(screen.getByTestId('ai-suggest'));

    await userEvent.click(await screen.findByTestId('ai-suggestion-error-retry'));

    expect(await screen.findByTestId('ai-suggestion-text-0')).toBeInTheDocument();
    expect(fetchChatHint).toHaveBeenCalledTimes(2);
  });
});

describe('scorul de chimie', () => {
  it('nu cere nimic până nu deschide utilizatorul panoul', async () => {
    renderBar();
    await waitFor(() => expect(fetchChemistry).not.toHaveBeenCalled());

    await userEvent.click(screen.getByTestId('ai-chemistry-open'));

    await waitFor(() => expect(fetchChemistry).toHaveBeenCalledWith('u1'));
    expect(await screen.findByTestId('ai-chemistry-score')).toHaveTextContent('Chimie: 78%');
    expect(screen.getByTestId('ai-chemistry-explanation')).toHaveTextContent(
      'Amândoi glumiți la fel.',
    );
  });

  it('păstrează cifra și explică lipsa explicației când AI-ul nu e configurat', async () => {
    vi.mocked(fetchChemistry).mockResolvedValue({
      score: 64,
      explanation: null,
      unavailable: 'not_configured',
    });
    renderBar();

    await userEvent.click(screen.getByTestId('ai-chemistry-open'));

    // Scorul e cel determinist, același din antetul conversației: nu dispare
    // pentru că partea AI a picat.
    expect(await screen.findByTestId('ai-chemistry-score')).toHaveTextContent('Chimie: 64%');
    expect(screen.getByTestId('ai-chemistry-no-explanation')).toHaveAttribute(
      'data-kind',
      'not_configured',
    );
  });

  it('arată eroarea când ruta refuză (profil ascuns, blocare)', async () => {
    vi.mocked(fetchChemistry).mockRejectedValue(new AiError('not_found'));
    renderBar();

    await userEvent.click(screen.getByTestId('ai-chemistry-open'));

    expect(await screen.findByTestId('ai-chemistry-error')).toHaveTextContent(
      'Conversația sau profilul nu mai sunt disponibile.',
    );
  });

  it('rămâne blocat cât timp nu știm cine e celălalt participant', async () => {
    renderBar(vi.fn(), '');

    expect(await screen.findByTestId('ai-chemistry-open')).toBeDisabled();
    await waitFor(() => expect(fetchChemistry).not.toHaveBeenCalled());
  });
});
