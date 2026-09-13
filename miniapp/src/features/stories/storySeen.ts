/**
 * Ce povești a văzut DEJA utilizatorul, pe dispozitivul ăsta.
 *
 * DE CE LOCAL, și nu de la server: nici `GET /stories/` și nici schema
 * `StoryOut` din `backend/app/schemas/story.py` nu au vreun câmp de tipul
 * `viewed` / `seen`, iar backendul nu e al meu. Fără o urmă locală, TOATE
 * cercurile din bară ar arăta identic, iar utilizatorul n-ar ști unde a rămas —
 * exact lucrul pe care bara de povești trebuie să-l spună dintr-o privire.
 * Consecința onestă a alegerii: marcajul e per dispozitiv; pe alt telefon,
 * aceleași povești apar iar ca nevăzute. Când backendul va avea câmpul lui,
 * `groupHasUnseen` e singurul loc de schimbat.
 *
 * Persistăm în `localStorage`, dar NU ne bazăm pe el: WebView-ul Telegram poate
 * refuza stocarea (vezi `api/tokenStore.ts`). Orice acces e în `try/catch`, iar
 * la refuz rămâne o copie în memorie, valabilă cât ține sesiunea.
 *
 * Cheile expiră singure: o poveste trăiește 24h (`expires_at`), deci ținem
 * momentul expirării și curățăm ce a trecut — altfel lista ar crește la
 * nesfârșit într-un storage de câțiva MB.
 */
import type { UserStories } from '@mobile/features/stories/types';

const STORAGE_KEY = 'flirt.stories.seen';

/** `id-ul poveștii` → momentul expirării ei, în milisecunde. */
type SeenMap = Record<string, number>;

let map: SeenMap | null = null;
/**
 * Instantaneul citit de React. `useSyncExternalStore` cere o referință STABILĂ
 * între randări (altfel intră în buclă), deci mulțimea se reconstruiește doar
 * când chiar se schimbă ceva.
 */
let snapshot: ReadonlySet<string> = new Set<string>();
const listeners = new Set<() => void>();

function readStorage(): SeenMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: SeenMap = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) out[id] = value;
    }
    return out;
  } catch {
    // Storage blocat, cotă depășită sau JSON stricat: pornim de la zero.
    return {};
  }
}

function writeStorage(value: SeenMap): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Fără persistență: marcajul rămâne valabil cât ține sesiunea.
  }
}

/** Aruncă poveștile deja expirate — nimeni nu le mai poate vedea oricum. */
function prune(value: SeenMap): SeenMap {
  const now = Date.now();
  const out: SeenMap = {};
  for (const [id, expiresAt] of Object.entries(value)) {
    if (expiresAt > now) out[id] = expiresAt;
  }
  return out;
}

function ensure(): SeenMap {
  if (map === null) {
    map = prune(readStorage());
    snapshot = new Set(Object.keys(map));
  }
  return map;
}

function publish(next: SeenMap): void {
  map = next;
  snapshot = new Set(Object.keys(next));
  writeStorage(next);
  for (const listener of listeners) listener();
}

/** Mulțimea id-urilor văzute. Referința se schimbă DOAR la o modificare reală. */
export function getSeenStories(): ReadonlySet<string> {
  ensure();
  return snapshot;
}

/** Abonare pentru `useSyncExternalStore`. */
export function subscribeToSeenStories(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Marchează o poveste ca văzută. Idempotent: dacă era deja marcată, NU anunță
 * abonații — altfel bara s-ar re-randa la fiecare cadru al vizualizatorului.
 */
export function markStorySeen(story: { id: string; expiresAt: string }): void {
  const current = ensure();
  if (current[story.id] !== undefined) return;
  const expiresAt = Date.parse(story.expiresAt);
  publish({
    ...current,
    // Data de expirare poate lipsi sau poate fi stricată: atunci ținem marcajul
    // 24h de acum, cât trăiește oricum o poveste.
    [story.id]: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 86_400_000,
  });
}

/** Grupul are măcar o poveste pe care utilizatorul nu a deschis-o încă? */
export function groupHasUnseen(group: UserStories, seen: ReadonlySet<string>): boolean {
  // Un grup fără povești încărcate (server care trimite doar numărul) e tratat
  // ca nevăzut: mai bine un cerc aprins în plus decât unul stins pe nedrept.
  if (group.stories.length === 0) return group.storyCount > 0;
  return group.stories.some((story) => !seen.has(story.id));
}

/** Doar pentru teste: golește marcajele și memoria locală. */
export function resetSeenStories(): void {
  publish({});
}
