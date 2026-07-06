/** Store Zustand pentru draftul wizardului de anketă (pas curent + câmpuri). */
import { create } from 'zustand';

import { AnketaDraft } from './types';

/** Numărul total de pași ai wizardului. */
export const ANKETA_STEPS = 4;

interface AnketaState {
  draft: Partial<AnketaDraft>;
  step: number;
  setField: <K extends keyof AnketaDraft>(key: K, value: AnketaDraft[K]) => void;
  next: () => void;
  prev: () => void;
  reset: () => void;
}

const initialDraft: Partial<AnketaDraft> = {
  languages: [],
  datingStatuses: [],
  interests: [],
};

export const useAnketaStore = create<AnketaState>((set) => ({
  draft: { ...initialDraft },
  step: 0,

  setField: (key, value) =>
    set((s) => ({ draft: { ...s.draft, [key]: value } })),

  next: () =>
    set((s) => ({ step: Math.min(s.step + 1, ANKETA_STEPS - 1) })),

  prev: () => set((s) => ({ step: Math.max(s.step - 1, 0) })),

  reset: () => set({ draft: { ...initialDraft }, step: 0 }),
}));
