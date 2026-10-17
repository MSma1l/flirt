/**
 * Permisiunea ca botul să-i scrie utilizatorului (`requestWriteAccess`).
 *
 * Fără ea, notificările botului (mesaj nou, like, match) nu ajung nicăieri. O
 * cerem BLÂND și o singură dată, din două locuri:
 *   - `chats`    — o invitație la prima deschidere a listei de conversații;
 *   - `settings` — un card lângă comutatoarele de notificări.
 *
 * „Nu bate la cap": fiecare loc are cheia lui în `localStorage`.
 *   - invitația din `chats` se arată într-o SINGURĂ sesiune: la prima afișare
 *     notăm `shown`; dacă omul o ignoră, nu mai apare la următoarea deschidere;
 *   - cardul din Setări rămâne până la un răspuns (Da / Nu acum) — acolo omul a
 *     venit singur, să-și regleze notificările;
 *   - un „Da" acceptat ascunde ambele, pentru totdeauna.
 * `localStorage` poate lipsi în WebView (try/catch peste tot): atunci memoria
 * modulului ține aceleași răspunsuri pentru sesiunea curentă.
 */
import { useCallback, useEffect, useState } from 'react';

import {
  allowsWriteToPm,
  canRequestWriteAccess,
  requestWriteAccess,
} from '@/telegram/bridge';

export type WriteAccessSlot = 'chats' | 'settings';

const KEY_PREFIX = 'flirt.writeAccess.';
const GRANTED_KEY = `${KEY_PREFIX}granted`;

type SlotState = 'shown' | 'dismissed';

/** Plasa pentru un `localStorage` indisponibil. */
const memory = new Map<string, string>();
/** Locurile afișate în sesiunea ASTA (invitația nu dispare la o remontare). */
const shownThisSession = new Set<WriteAccessSlot>();

function read(key: string): string | null {
  try {
    const value = window.localStorage.getItem(key);
    if (value !== null) return value;
  } catch {
    /* stocare indisponibilă */
  }
  return memory.get(key) ?? null;
}

function write(key: string, value: string): void {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* rămâne în memorie pentru sesiunea curentă */
  }
}

/** Doar pentru teste: uită tot ce s-a reținut în memorie. */
export function resetWriteAccessMemory(): void {
  memory.clear();
  shownThisSession.clear();
}

/** Are rost să cerem? Botul nu are voie încă, iar clientul știe să ceară. */
function needsWriteAccess(): boolean {
  return !allowsWriteToPm() && canRequestWriteAccess() && read(GRANTED_KEY) !== 'true';
}

function shouldShow(slot: WriteAccessSlot): boolean {
  if (!needsWriteAccess()) return false;
  const state = read(`${KEY_PREFIX}${slot}`) as SlotState | null;
  if (state === 'dismissed') return false;
  if (slot === 'chats' && state === 'shown') return shownThisSession.has(slot);
  return true;
}

export interface WriteAccessPrompt {
  visible: boolean;
  busy: boolean;
  /** „Da" → fereastra nativă a Telegramului. */
  allow: () => Promise<void>;
  /** „Nu acum" → nu mai apare în locul ăsta. */
  dismiss: () => void;
}

export function useWriteAccessPrompt(slot: WriteAccessSlot): WriteAccessPrompt {
  const [visible, setVisible] = useState(() => shouldShow(slot));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible || slot !== 'chats' || shownThisSession.has(slot)) return;
    shownThisSession.add(slot);
    write(`${KEY_PREFIX}${slot}`, 'shown');
  }, [visible, slot]);

  const dismiss = useCallback(() => {
    shownThisSession.delete(slot);
    write(`${KEY_PREFIX}${slot}`, 'dismissed');
    setVisible(false);
  }, [slot]);

  const allow = useCallback(async () => {
    setBusy(true);
    const granted = await requestWriteAccess();
    setBusy(false);
    if (granted) write(GRANTED_KEY, 'true');
    // Și la refuz ne oprim: omul a văzut deja fereastra nativă și a răspuns.
    dismiss();
  }, [dismiss]);

  return { visible, busy, allow, dismiss };
}
