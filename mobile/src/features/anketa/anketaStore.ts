/** Store Zustand pentru draftul wizardului de anketă (pas curent + câmpuri + poze). */
import { create } from 'zustand';

import { moveItem } from '@/features/photos/reorder';
import { LocalPhoto } from '@/features/photos/types';

import { AnketaDraft } from './types';
import { DEFAULT_SEARCH_AGE_MAX, DEFAULT_SEARCH_AGE_MIN } from './validation';

/** Numărul total de pași ai wizardului (ultimul: pozele). */
export const ANKETA_STEPS = 6;

/** Indexul pasului „Pe cine cauți" (preferințele de căutare). */
export const SEARCH_PREFS_STEP = 4;

/**
 * Indexul pasului cu poze — ultimul, DELIBERAT: backend-ul respinge uploadul de
 * poze pentru un profil inexistent (`/profiles/photos` → 404), deci pozele urcă
 * abia după ce anketa a fost salvată (PUT /profiles/me creează profilul).
 */
export const PHOTOS_STEP = 5;

interface AnketaState {
  draft: Partial<AnketaDraft>;
  /** Pozele alese din galerie, deja comprimate, în ordine (prima = principală). */
  photos: LocalPhoto[];
  step: number;
  setField: <K extends keyof AnketaDraft>(key: K, value: AnketaDraft[K]) => void;
  addPhoto: (photo: LocalPhoto) => void;
  removePhoto: (index: number) => void;
  movePhoto: (from: number, to: number) => void;
  next: () => void;
  prev: () => void;
  reset: () => void;
}

const initialDraft: Partial<AnketaDraft> = {
  languages: [],
  datingStatuses: [],
  interests: [],
  // Preferințele de căutare pornesc de la intervalul implicit; genul rămâne
  // nealess intenționat — pasul „Pe cine cauți" cere o alegere explicită.
  interestedIn: [],
  ageMin: DEFAULT_SEARCH_AGE_MIN,
  ageMax: DEFAULT_SEARCH_AGE_MAX,
};

export const useAnketaStore = create<AnketaState>((set) => ({
  draft: { ...initialDraft },
  photos: [],
  step: 0,

  setField: (key, value) =>
    set((s) => ({ draft: { ...s.draft, [key]: value } })),

  addPhoto: (photo) => set((s) => ({ photos: [...s.photos, photo] })),

  removePhoto: (index) =>
    set((s) => ({ photos: s.photos.filter((_, i) => i !== index) })),

  movePhoto: (from, to) => set((s) => ({ photos: moveItem(s.photos, from, to) })),

  next: () =>
    set((s) => ({ step: Math.min(s.step + 1, ANKETA_STEPS - 1) })),

  prev: () => set((s) => ({ step: Math.max(s.step - 1, 0) })),

  reset: () => set({ draft: { ...initialDraft }, photos: [], step: 0 }),
}));
