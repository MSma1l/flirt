/**
 * Butonul „Deschide în Telegram" — drumul de întoarcere.
 *
 * Cererea proprietarului, textual: „un buton care trece în Telegram". Ecranul
 * pe care îl vede cineva care a deschis `https://miniapp.flrt.md` direct în
 * Chrome nu e o eroare de rezolvat, e o persoană aflată în locul greșit; tot ce
 * are nevoie e un buton care o duce în chatul botului.
 *
 * Adresa se construiește DIN MEDIU (`VITE_TELEGRAM_BOT_USERNAME`, vezi
 * `config.ts`). Dacă numele lipsește, funcțiile de aici întorc `null` și
 * butonul dispare din interfață — un buton care duce la un chat inexistent e
 * mai rău decât lipsa lui.
 */
import type { StatusAction } from '@/components/StatusScreen';
import { getBotChatUrl } from '@/config';

import { openTelegramLink } from './bridge';

export { getBotChatUrl, getBotUsername } from '@/config';

export interface TelegramBotActionOptions {
  /** Textul butonului (tradus de apelant). */
  label: string;
  /** `true` → acțiune secundară, cu contur. */
  ghost?: boolean;
  testId?: string;
}

/**
 * Acțiunea pentru `StatusScreen`, sau `null` când botul nu e configurat.
 *
 * E o legătură reală, nu un buton cu `window.open`: în afara Telegram browserul
 * o deschide singur, iar în interiorul Telegram interceptăm clicul și o dăm
 * clientului prin `openTelegramLink`, ca să sară direct în chat în loc să
 * deschidă un browser peste Mini App.
 */
export function telegramBotAction(options: TelegramBotActionOptions): StatusAction | null {
  const url = getBotChatUrl();
  if (!url) return null;

  return {
    label: options.label,
    href: url,
    ghost: options.ghost ?? false,
    testId: options.testId ?? 'open-in-telegram',
    onClick: (event) => {
      // `openTelegramLink` întoarce `true` doar dacă clientul chiar a preluat
      // deschiderea. Altfel lăsăm navigarea obișnuită să se producă.
      if (openTelegramLink(url)) event.preventDefault();
    },
  };
}

export default telegramBotAction;
