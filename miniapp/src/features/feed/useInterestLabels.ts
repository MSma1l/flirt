/**
 * Etichetele traduse ale intereselor de pe card.
 *
 * DEFECTUL: feedul trimite `top_interests` ca SLUG-uri („animals", „cars",
 * „technology"), iar cardul le afișa ca atare — un utilizator român sau rus
 * vedea chei englezești brute.
 *
 * SURSA TRADUCERII e aceeași ca în profil și în setări: catalogul de referință
 * de pe server (`fetchReference(language)` → `GET /profiles/reference`), unde
 * fiecare interes vine cu etichetele în toate limbile. Folosim ACEEAȘI cheie de
 * query ca `ProfileScreen` (`['profile-reference', language]`), deci cache-ul e
 * comun: dacă userul a deschis profilul, cardul nu mai face nicio cerere.
 *
 * Cât timp catalogul nu a venit (sau n-a putut veni), NU arătăm cipurile: o
 * cheie brută e exact defectul reclamat, iar un card fără cipuri e doar un card
 * mai sobru. Un slug pe care catalogul nu-l cunoaște e sărit, din același motiv.
 */
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_LANGUAGE, normalizeLanguage } from '@mobile/i18n/config';

import { fetchReference } from '@/features/profile/profileApi';

/** Catalogul se schimbă rar; o oră de prospețime e generoasă și ieftină. */
const REFERENCE_STALE_MS = 60 * 60 * 1000;

/**
 * Întoarce o funcție care transformă o listă de slug-uri în etichete traduse,
 * păstrând ordinea și sărind slug-urile necunoscute. Listă goală cât timp
 * catalogul nu e disponibil.
 */
export function useInterestLabels(
  /** Cererea pleacă doar când există un card cu interese de tradus. */
  enabled = true,
): (slugs: readonly string[]) => string[] {
  const { i18n } = useTranslation();
  const language = normalizeLanguage(i18n.language) ?? DEFAULT_LANGUAGE;
  const { data } = useQuery({
    queryKey: ['profile-reference', language],
    queryFn: () => fetchReference(language),
    staleTime: REFERENCE_STALE_MS,
    enabled,
  });

  const interests = data?.interests;
  return useCallback(
    (slugs: readonly string[]) => {
      if (!interests) return [];
      const labels: string[] = [];
      for (const slug of slugs) {
        const label = interests.find((option) => option.slug === slug)?.label;
        if (label) labels.push(label);
      }
      return labels;
    },
    [interests],
  );
}
