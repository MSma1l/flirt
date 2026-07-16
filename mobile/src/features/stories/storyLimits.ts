/**
 * Mesaje pentru media de story (TZ secț. 11).
 *
 * Un story e DOAR o poză. Video-ul a fost scos deliberat: nu-l putem modera automat,
 * iar Apple Guideline 1.2 cere filtrarea conținutului obiecționabil (pozele trec prin
 * moderarea NSFW din backend, un clip n-ar trece prin nimic). Poarta finală rămâne
 * serverul: `POST /stories/media` refuză orice video cu 422.
 *
 * Limitele de dimensiune ale pozelor stau într-un singur loc — `features/photos`
 * (`compressPhoto`), folosit și de pozele de profil.
 */

/** Mesaje afișabile (RO), fără module native — testabile separat. */
export const STORY_MESSAGES = {
  pickerFailed: 'Nu am putut deschide galeria. Încearcă din nou.',
  permissionDenied: 'Avem nevoie de acces la galerie ca să alegi o poză.',
  permissionBlocked:
    'Accesul la galerie este oprit. Deschide setările, activează-l pentru FLIRT, apoi revino.',
  cameraPermission: 'Avem nevoie de acces la cameră ca să faci o poză pentru story.',
  cameraPermissionBlocked:
    'Accesul la cameră este oprit. Deschide setările și activează camera pentru FLIRT, apoi revino.',
  cameraUnavailable:
    'Nu am putut porni camera aici. Poți alege în schimb o poză din galerie.',
  captureFailed: 'Nu am putut face poza. Încearcă din nou.',
  uploadFailed: 'Nu am putut încărca poza. Încearcă din nou.',
  createFailed: 'Nu am putut publica povestea. Încearcă din nou.',
} as const;
