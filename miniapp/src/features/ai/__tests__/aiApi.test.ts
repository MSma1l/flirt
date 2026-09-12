/**
 * Stratul de date AI, verificat pe CONTRACTUL REAL al backendului
 * (`backend/app/api/v1/ai.py` + `backend/app/schemas/ai.py`):
 *
 *  - `POST /ai/chat-hint` cu `{ chat_id }` în corp, niciodată în cale;
 *  - degradarea vine cu 200 + `available: false` + `reason`, nu cu 5xx;
 *  - `GET /ai/chemistry/{id}` întoarce `score` MEREU, chiar și fără AI.
 *
 * Aici se izolează DOAR clientul HTTP; restul (parsare, clasificarea cauzelor)
 * rulează real — altfel testele ar verifica mock-urile, nu codul.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

const { api } = await import('@/api/client');
const { AI_ROUTES, fetchChatHint, fetchChemistry } = await import('../aiApi');
const { AiError } = await import('../aiErrors');

/** Un eșec axios credibil: `isAxiosError` e exact ce verifică `axios.isAxiosError`. */
function httpError(status: number, data: unknown = {}) {
  return Object.assign(new Error(`HTTP ${status}`), {
    isAxiosError: true,
    response: { status, data },
  });
}

/** Cerere care nu a ajuns nicăieri: fără `response`. */
function networkError() {
  return Object.assign(new Error('Network Error'), { isAxiosError: true });
}

/** Rulează apelul și întoarce `AiError`-ul aruncat. */
async function kindOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(AiError);
    return (error as InstanceType<typeof AiError>).kind;
  }
  throw new Error('apelul ar fi trebuit să arunce');
}

beforeEach(() => {
  vi.mocked(api.post).mockReset();
  vi.mocked(api.get).mockReset();
});

describe('sugestii de mesaj', () => {
  it('trimite `chat_id` în CORP, prin POST pe /ai/chat-hint', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: { available: true, suggestions: ['Salut!', 'Ce mai faci?'], cached: false },
    });

    const hint = await fetchChatHint('c1');

    expect(api.post).toHaveBeenCalledWith(AI_ROUTES.chatHint, { chat_id: 'c1' });
    expect(AI_ROUTES.chatHint).toBe('/ai/chat-hint');
    expect(hint.suggestions).toEqual(['Salut!', 'Ce mai faci?']);
  });

  it('curăță spațiile și aruncă variantele goale', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: { available: true, suggestions: ['  Salut!  ', '', '   ', 42, 'Hai la o cafea'] },
    });

    const hint = await fetchChatHint('c1');
    expect(hint.suggestions).toEqual(['Salut!', 'Hai la o cafea']);
  });

  it.each([
    ['ai_not_configured', 'not_configured'],
    ['ai_provider_error', 'provider'],
    ['ai_empty_response', 'provider'],
    ['ai_no_history', 'no_history'],
  ])('traduce degradarea 200 + reason=%s în cauza „%s"', async (reason, expected) => {
    vi.mocked(api.post).mockResolvedValue({ data: { available: false, reason, suggestions: [] } });
    expect(await kindOf(() => fetchChatHint('c1'))).toBe(expected);
  });

  it('o etichetă `reason` necunoscută rămâne „furnizorul nu a răspuns", nu cutie neagră', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { available: false, reason: 'ceva_nou' } });
    expect(await kindOf(() => fetchChatHint('c1'))).toBe('provider');
  });

  it('`available: true` cu listă goală e tot o pană, nu o bulă goală', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { available: true, suggestions: [] } });
    expect(await kindOf(() => fetchChatHint('c1'))).toBe('provider');
  });

  it.each([
    [403, 'disabled'],
    [404, 'not_found'],
    [429, 'rate_limit'],
    [500, 'unknown'],
  ])('traduce codul HTTP %i în cauza „%s"', async (status, expected) => {
    vi.mocked(api.post).mockRejectedValue(httpError(status));
    expect(await kindOf(() => fetchChatHint('c1'))).toBe(expected);
  });

  it('o cerere care nu ajunge la server e „fără rețea", nu „AI stricat"', async () => {
    vi.mocked(api.post).mockRejectedValue(networkError());
    expect(await kindOf(() => fetchChatHint('c1'))).toBe('network');
  });
});

describe('scorul de chimie', () => {
  it('întoarce scorul și explicația când AI-ul a răspuns', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { user_id: 'u1', score: 78, available: true, explanation: '  Aveți umor comun.  ' },
    });

    const result = await fetchChemistry('u1');

    expect(api.get).toHaveBeenCalledWith('/ai/chemistry/u1');
    expect(result).toEqual({ score: 78, explanation: 'Aveți umor comun.', unavailable: null });
  });

  it('păstrează scorul DETERMINIST chiar când AI-ul lipsește, și spune de ce', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { user_id: 'u1', score: 64, available: false, reason: 'ai_not_configured' },
    });

    const result = await fetchChemistry('u1');

    // Scorul e cel din `services/compatibility.py` — nu-l ascundem pentru că
    // partea AI a picat.
    expect(result.score).toBe(64);
    expect(result.explanation).toBeNull();
    expect(result.unavailable).toBe('not_configured');
  });

  it('plafonează un scor stricat la 0–100', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { score: 4000, available: true, explanation: 'x' } });
    expect((await fetchChemistry('u1')).score).toBe(100);
  });

  it('propagă 403 (blocare / AI oprit) ca eroare, nu ca scor', async () => {
    vi.mocked(api.get).mockRejectedValue(httpError(403));
    expect(await kindOf(() => fetchChemistry('u1'))).toBe('disabled');
  });

  it('propagă 404 (profil ascuns, banat sau șters)', async () => {
    vi.mocked(api.get).mockRejectedValue(httpError(404));
    expect(await kindOf(() => fetchChemistry('u1'))).toBe('not_found');
  });
});
