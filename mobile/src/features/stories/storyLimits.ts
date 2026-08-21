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
import i18n from '@/i18n';

/**
 * Cheile mesajelor afișabile. Modulul e folosit din `storyPicker` și
 * `storyCamera`, care NU sunt componente, deci nu pot chema `useTranslation`.
 */
const MESSAGE_KEY = {
  pickerFailed: 'stories:messages.pickerFailed',
  permissionDenied: 'stories:messages.permissionDenied',
  permissionBlocked: 'stories:messages.permissionBlocked',
  cameraPermission: 'stories:messages.cameraPermission',
  cameraPermissionBlocked: 'stories:messages.cameraPermissionBlocked',
  cameraUnavailable: 'stories:messages.cameraUnavailable',
  captureFailed: 'stories:messages.captureFailed',
  uploadFailed: 'stories:messages.uploadFailed',
  createFailed: 'stories:messages.createFailed',
} as const;

export type StoryMessageKey = keyof typeof MESSAGE_KEY;

/**
 * Mesajul, în limba activă.
 *
 * Se citește la FIECARE apel, nu la încărcarea modulului: altfel primul mesaj ar
 * îngheța limba pentru toată sesiunea. Același tipar ca `features/billing/iap.ts`
 * și `utils/dialog.ts`.
 */
export function storyMessage(key: StoryMessageKey): string {
  return i18n.t(MESSAGE_KEY[key]);
}
