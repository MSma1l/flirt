/**
 * Hook comun pentru alegerea unei poze din galerie (wizard + editare profil).
 *
 * Concentrează într-un singur loc tratarea refuzului de permisiune: ecranele nu
 * rămân „moarte", ci primesc `permissionDenied` + `openSettings()` ca să poată
 * arăta un mesaj clar și o cale de recuperare.
 */
import { useCallback, useState } from 'react';

import { openAppSettings, pickPhoto } from './photoPicker';
import { LocalPhoto } from './types';
import { PERMISSION_DENIED_MESSAGE } from './validation';

/** Starea și acțiunile expuse ecranelor. */
export interface PhotoPickerApi {
  /** Deschide galeria; `null` = anulat / refuzat / respins (vezi `error`). */
  pick: () => Promise<LocalPhoto | null>;
  /** True cât timp galeria e deschisă / poza se comprimă. */
  picking: boolean;
  /** True dacă utilizatorul a refuzat accesul la galerie. */
  permissionDenied: boolean;
  /** Mesajul de eroare de afișat (permisiune, tip nepermis, poză prea mare). */
  error: string | null;
  /** Șterge mesajul de eroare (ex. la o nouă încercare). */
  clearError: () => void;
  /** Deschide Setările sistemului — calea de recuperare după refuz. */
  openSettings: () => void;
}

export function usePhotoPicker(): PhotoPickerApi {
  const [picking, setPicking] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const pick = useCallback(async (): Promise<LocalPhoto | null> => {
    setError(null);
    setPicking(true);
    try {
      const result = await pickPhoto();

      if (result.status === 'picked') {
        setPermissionDenied(false);
        return result.photo;
      }
      if (result.status === 'denied') {
        setPermissionDenied(true);
        setError(PERMISSION_DENIED_MESSAGE);
        return null;
      }
      if (result.status === 'rejected') {
        setError(result.message);
        return null;
      }
      return null; // 'cancelled' — utilizatorul a închis galeria, fără eroare.
    } finally {
      setPicking(false);
    }
  }, []);

  const openSettings = useCallback(() => {
    void openAppSettings();
  }, []);

  return { pick, picking, permissionDenied, error, clearError, openSettings };
}
