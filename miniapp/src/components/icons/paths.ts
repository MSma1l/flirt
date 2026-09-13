/**
 * Desenele setului de iconițe FLIRT.
 *
 * De ce NU o bibliotecă. Avem nevoie de treisprezece simboluri. Cel mai mic
 * pachet serios de iconițe aduce câteva sute, plus un strat de componente:
 * greutate și o dependență în plus pentru ceva ce încape în acest fișier. În
 * plus, politica de securitate a paginii (CSP) permite scripturi doar de la noi
 * și de la Telegram, deci nimic nu se poate încărca de pe un CDN. Un set propriu
 * e mai mic, intră în același bundle și îl putem potrivi cu logoul.
 *
 * REGULILE SETULUI — respectate de fiecare desen de mai jos:
 *
 *  1. Aceeași fereastră de desen: `0 0 24 24`. Iconițele stau pe aceeași grilă,
 *     deci se aliniază optic una lângă alta în bara de taburi.
 *  2. O singură cale (`d`) pe iconiță. Unde forma cere mai multe bucăți (ochii
 *     unui zâmbet, dinții unei roți), ele stau în ACEEAȘI cale, ca subtrasee.
 *  3. Desenate ca linie, nu ca umplere: `fill: none`, `stroke: currentColor`.
 *     Culoarea vine din CSS, deci tabul activ se colorează singur și nu avem
 *     nevoie de un al doilea fișier pentru varianta colorată.
 *  4. Aceeași grosime de linie pe tot setul (vezi `STROKE` din `Icon.tsx`).
 *     O iconiță mai groasă decât vecinele se vede imediat.
 *  5. Aceeași „rază de aer": desenele stau între ~2.5 și ~21.5 pe ambele axe,
 *     ca niciuna să nu pară mai mare decât celelalte la aceeași dimensiune.
 *  6. Colțurile și capetele sunt rotunjite (`stroke-linecap/linejoin: round`),
 *     ca în logo și în butoanele-pastilă ale produsului.
 */

/** Numele iconițelor. Tot ce cere o iconiță trece prin această listă. */
export type IconName =
  // bara de taburi
  | 'heart'
  | 'calendar'
  | 'chat'
  | 'person'
  | 'menu'
  // meniul „Mai multe"
  | 'stories'
  | 'star'
  | 'smile'
  | 'passport'
  | 'ticket'
  | 'crown'
  | 'block'
  | 'settings'
  // decor de listă
  | 'chevron';

export const ICON_PATHS: Record<IconName, string> = {
  /**
   * INIMĂ — feed. Doi lobi de cerc care se întâlnesc într-o adâncitură și
   * coboară într-un vârf. Aceeași curbură plină ca în logo, nu inima ascuțită
   * de emoji.
   */
  heart: 'M20.2 5.35a5.05 5.05 0 0 0-7.14 0L12 6.4l-1.06-1.05a5.05 5.05 0 0 0-7.14 7.14L12 20.6l8.2-8.11a5.05 5.05 0 0 0 0-7.14Z',

  /**
   * CALENDAR — evenimente. Foaia cu două agățători și o linie de antet. Punctul
   * din mijloc marchează ziua: fără el, forma ar fi doar un dreptunghi.
   */
  calendar: 'M6.6 3v2.8M17.4 3v2.8M3.6 9.6h16.8M6.2 5.4h11.6a2.6 2.6 0 0 1 2.6 2.6v10.2a2.6 2.6 0 0 1-2.6 2.6H6.2a2.6 2.6 0 0 1-2.6-2.6V8a2.6 2.6 0 0 1 2.6-2.6ZM8.1 14.4h.01M12 14.4h.01M15.9 14.4h.01',

  /**
   * BULĂ DE DIALOG — mesaje. Coada coboară din colțul de jos-stânga, ca în
   * majoritatea aplicațiilor de chat: e reperul care o desparte de un simplu
   * dreptunghi rotunjit.
   */
  chat: 'M5.6 3.8h12.8a2.6 2.6 0 0 1 2.6 2.6v7.6a2.6 2.6 0 0 1-2.6 2.6H11.2l-4.4 3.6v-3.6H5.6A2.6 2.6 0 0 1 3 14V6.4a2.6 2.6 0 0 1 2.6-2.6Z',

  /**
   * PERSOANĂ — profil. Cap rotund și umeri ca un arc. Nu un zâmbet: zâmbetul e
   * testul de umor, iar două iconițe apropiate s-ar confunda.
   */
  person: 'M12 3.6a3.7 3.7 0 1 1 0 7.4 3.7 3.7 0 0 1 0-7.4ZM5 20.6a7 7 0 0 1 14 0',

  /**
   * MENIU — patru pătrate rotunjite. Nu trei linii: „hamburgerul" e un obiect
   * de web, iar aici deschide un ecran cu destinații, nu un sertar lateral.
   */
  menu: 'M5.6 4.2h3.6a1.4 1.4 0 0 1 1.4 1.4v3.6a1.4 1.4 0 0 1-1.4 1.4H5.6a1.4 1.4 0 0 1-1.4-1.4V5.6a1.4 1.4 0 0 1 1.4-1.4ZM14.8 4.2h3.6a1.4 1.4 0 0 1 1.4 1.4v3.6a1.4 1.4 0 0 1-1.4 1.4h-3.6a1.4 1.4 0 0 1-1.4-1.4V5.6a1.4 1.4 0 0 1 1.4-1.4ZM5.6 13.4h3.6a1.4 1.4 0 0 1 1.4 1.4v3.6a1.4 1.4 0 0 1-1.4 1.4H5.6a1.4 1.4 0 0 1-1.4-1.4v-3.6a1.4 1.4 0 0 1 1.4-1.4ZM14.8 13.4h3.6a1.4 1.4 0 0 1 1.4 1.4v3.6a1.4 1.4 0 0 1-1.4 1.4h-3.6a1.4 1.4 0 0 1-1.4-1.4v-3.6a1.4 1.4 0 0 1 1.4-1.4Z',

  /**
   * STORIES — inelul segmentat din jurul unui cerc, semnul devenit standard
   * pentru poveștile care expiră. Segmentele lasă patru pauze, ca inelul să nu
   * fie confundat cu un buton de înregistrare.
   */
  stories: 'M13.49 3.53a8.6 8.6 0 0 1 6.98 6.98M20.47 13.49a8.6 8.6 0 0 1-6.98 6.98M10.51 20.47a8.6 8.6 0 0 1-6.98-6.98M3.53 10.51a8.6 8.6 0 0 1 6.98-6.98M12 8.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8Z',

  /** STEA — favorite. Cinci colțuri, vârfurile pe un cerc, colțurile rotunjite. */
  star: 'M12 3.4 14.35 9.06 20.46 9.55 15.8 13.54 17.23 19.5 12 16.3 6.77 19.5 8.2 13.54 3.54 9.55 9.65 9.06Z',

  /**
   * ZÂMBET — testul de umor. Cerc, două puncte și un arc. Punctele sunt segmente
   * de lungime zero: cu capete rotunde se desenează ca două bile perfecte, fără
   * să adauge o a doua cale.
   */
  smile: 'M12 3.4a8.6 8.6 0 1 1 0 17.2 8.6 8.6 0 0 1 0-17.2ZM8.7 10.1h.01M15.3 10.1h.01M8.2 14.4a4.6 4.6 0 0 0 7.6 0',

  /**
   * FLIRT PASSPORT — carnetul: o copertă în picioare, cotorul marcat, iar în
   * interior emblema rotundă și două rânduri de date.
   */
  passport: 'M6.8 3.2h10.4a1.8 1.8 0 0 1 1.8 1.8v14a1.8 1.8 0 0 1-1.8 1.8H6.8A1.8 1.8 0 0 1 5 18.8V5a1.8 1.8 0 0 1 1.8-1.8ZM12 7.4a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM9 16.8h6',

  /**
   * BILET — dreptunghi cu două crestături pe marginile laterale, la jumătatea
   * înălțimii, și cu linia perforată a talonului. Crestăturile sunt esențiale:
   * fără ele forma e un card. Ele stau pe LATERALE, nu sus-jos: cu crestături
   * sus și jos plus linia verticală, desenul citea ca o carte deschisă.
   */
  ticket: 'M3.2 7.6a1.8 1.8 0 0 1 1.8-1.8h14a1.8 1.8 0 0 1 1.8 1.8v2.2a2.2 2.2 0 0 0 0 4.4v2.2a1.8 1.8 0 0 1-1.8 1.8H5a1.8 1.8 0 0 1-1.8-1.8v-2.2a2.2 2.2 0 0 0 0-4.4ZM14.4 7.9v1.6M14.4 11.2v1.6M14.4 14.5v1.6',

  /**
   * COROANĂ — abonamentul. Semnul „premium" fără cuvinte și fără steluțe: trei
   * vârfuri, două văi și o bază dreaptă.
   */
  crown: 'M3.4 7.6 7.3 11.2 12 4.6l4.7 6.6 3.9-3.6-1.5 11.4H4.9Z',

  /**
   * BLOCARE — cercul tăiat. Linia merge exact pe diagonala cercului, altfel
   * semnul pare strâmb la 22 de pixeli.
   */
  block: 'M12 3.4a8.6 8.6 0 1 1 0 17.2 8.6 8.6 0 0 1 0-17.2ZM5.92 5.92l12.16 12.16',

  /**
   * SETĂRI — roata dințată cu opt dinți, generată pe cerc, deci perfect
   * simetrică. Cercul din mijloc o ține „goală", ca restul setului.
   */
  settings: 'M9.87 5.65 9.99 2.92h4.02l.12 2.73a6.7 6.7 0 0 1 .86.35L17 4.16 19.84 7 18 9.01a6.7 6.7 0 0 1 .35.86l2.73.12v4.02l-2.73.12a6.7 6.7 0 0 1-.35.86L19.84 17 17 19.84 14.99 18a6.7 6.7 0 0 1-.86.35l-.12 2.73H9.99l-.12-2.73a6.7 6.7 0 0 1-.86-.35L7 19.84 4.16 17 6 14.99a6.7 6.7 0 0 1-.35-.86l-2.73-.12V9.99l2.73-.12A6.7 6.7 0 0 1 6 9.01L4.16 7 7 4.16 9.01 6ZM12 8.8a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4Z',

  /** SĂGEATĂ — „intră aici". Singurul desen deschis din set. */
  chevron: 'M9.5 5.5 16 12l-6.5 6.5',
};
