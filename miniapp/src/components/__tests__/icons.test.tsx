/**
 * Setul de iconițe: bara de taburi și meniul „Mai multe".
 *
 * Ce apărăm aici. Iconițele erau caractere text („✉", „☺", „≡"). Un glif se
 * randează cu fontul sistemului: altă formă pe fiecare platformă, altă grosime
 * decât a vecinilor, alt centru optic — iar unele nici nu există în fontul
 * telefonului și lăsau un pătrat gol. Testele de mai jos țin desenele SVG pe
 * loc: pe aceeași grilă, cu aceeași grosime, invizibile pentru cititorul de
 * ecran și cu o stare activă care se vede FĂRĂ culoare.
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

import i18n from '@/i18n';
import { renderWithProviders } from '@/test/harness';

import { ICON_PATHS, STROKE, STROKE_ACTIVE, type IconName } from '../icons';
import { MENU_ENTRIES, MoreScreen } from '../MoreScreen';
import { TABS, TabBar } from '../TabBar';

function renderAt(ui: React.ReactElement, path: string) {
  return renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={ui} />
      </Routes>
    </MemoryRouter>,
  );
}

const label = (key: string) => i18n.t(key, { ns: 'miniapp' });

describe('setul de iconițe', () => {
  it('fiecare nume folosit în navigare are un desen', () => {
    const folosite: IconName[] = [
      ...TABS.map((tab) => tab.icon),
      ...MENU_ENTRIES.map((entry) => entry.icon),
      'chevron',
    ];

    for (const name of folosite) {
      expect(ICON_PATHS[name], `lipsește desenul „${name}"`).toBeTruthy();
    }
  });

  it('niciun desen nu se repetă: două ecrane cu aceeași iconiță nu se deosebesc', () => {
    const desene = Object.values(ICON_PATHS);
    expect(new Set(desene).size).toBe(desene.length);
  });

  it('toate desenele stau pe aceeași grilă și în aceeași margine de aer', () => {
    const { container } = renderAt(<MoreScreen />, '/meniu');

    for (const svg of container.querySelectorAll('svg.icon')) {
      // Aceeași fereastră pentru tot setul = aliniere optică în bara de taburi.
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    }

    // Niciun număr dintr-un desen nu depășește 22 — nici coordonată absolută,
    // nici deplasare relativă. Cu o grosime de linie de 1.75, asta ține tot
    // setul la cel puțin un pixel de marginea ferestrei de 24, deci nicio
    // iconiță nu pare mai mare decât vecinele ei la aceeași dimensiune.
    // Atenție la tokenizare: într-o cale SVG, „.86.35" sunt DOUĂ numere.
    const NUMAR = /-?(?:\d+\.?\d*|\.\d+)/g;
    for (const [name, d] of Object.entries(ICON_PATHS)) {
      for (const bucata of d.match(NUMAR) ?? []) {
        expect(Math.abs(Number(bucata)), `„${name}" iese din grilă: ${bucata}`).toBeLessThanOrEqual(22);
      }
    }
  });

  it('culoarea vine din CSS, iar dimensiunea NU e scrisă în marcaj', () => {
    const { container } = renderAt(<TabBar />, '/feed');

    for (const svg of container.querySelectorAll('svg.icon')) {
      // `currentColor` = tabul activ se colorează singur, fără un al doilea desen.
      expect(svg.getAttribute('stroke')).toBe('currentColor');
      expect(svg.getAttribute('fill')).toBe('none');
      // Mărimea o dă `.icon` din CSS; scrisă în marcaj, ar trebui o componentă
      // separată pentru fiecare loc în care apare iconița.
      expect(svg.getAttribute('width')).toBeNull();
      expect(svg.getAttribute('height')).toBeNull();
    }
  });
});

describe('bara de taburi: iconițe', () => {
  it('fiecare tab randează o iconiță desenată, nu un caracter', () => {
    const { container } = renderAt(<TabBar />, '/feed');

    const desene = container.querySelectorAll('.tab svg.icon');
    expect(desene).toHaveLength(TABS.length);

    for (const tab of TABS) {
      expect(container.querySelector(`.tab svg[data-icon="${tab.icon}"]`)).not.toBeNull();
    }
  });

  it('iconițele sunt ascunse de cititorul de ecran; eticheta rămâne numele legăturii', () => {
    const { container } = renderAt(<TabBar />, '/feed');

    for (const svg of container.querySelectorAll('svg.icon')) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    }

    // Numele accesibil e EXACT eticheta: iconița nu adaugă nimic de citit.
    for (const tab of TABS) {
      expect(screen.getByRole('link', { name: label(tab.labelKey) })).toBeInTheDocument();
    }
  });

  it('tabul activ se vede fără culoare: linie mai groasă și o bară sub etichetă', () => {
    const activ = TABS[0]!;
    const { container } = renderAt(<TabBar />, activ.to);

    const iconActiva = container.querySelector(`.tab--active svg[data-icon="${activ.icon}"]`);
    expect(iconActiva?.getAttribute('stroke-width')).toBe(String(STROKE_ACTIVE));
    expect(STROKE_ACTIVE).toBeGreaterThan(STROKE);

    const indicatorActiv = container.querySelector('.tab--active .tab__indicator');
    expect(indicatorActiv?.getAttribute('data-active')).toBe('true');
    expect(indicatorActiv?.getAttribute('aria-hidden')).toBe('true');

    // Și doar el: restul rămân pe grosimea de bază, cu indicatorul stins.
    for (const tab of TABS.slice(1)) {
      const svg = container.querySelector(`.tab:not(.tab--active) svg[data-icon="${tab.icon}"]`);
      expect(svg?.getAttribute('stroke-width'), tab.labelKey).toBe(String(STROKE));
    }

    const stinse = container.querySelectorAll('.tab__indicator[data-active="false"]');
    expect(stinse).toHaveLength(TABS.length - 1);
  });

  it('indicatorul stă în DOM și când tabul e inactiv, ca bara să nu tresară', () => {
    const { container } = renderAt(<TabBar />, TABS[0]!.to);

    // Dacă ar fi montat doar pe tabul activ, apariția lui ar împinge eticheta
    // cu câțiva pixeli la fiecare schimbare de tab.
    expect(container.querySelectorAll('.tab__indicator')).toHaveLength(TABS.length);
  });
});

describe('meniul „Mai multe": iconițe', () => {
  it('fiecare intrare randează o iconiță proprie', () => {
    const { container } = renderAt(<MoreScreen />, '/meniu');

    for (const entry of MENU_ENTRIES) {
      expect(
        container.querySelector(`.more-item svg[data-icon="${entry.icon}"]`),
        entry.labelKey,
      ).not.toBeNull();
    }

    const numeFolosite = MENU_ENTRIES.map((entry) => entry.icon);
    expect(new Set(numeFolosite).size).toBe(MENU_ENTRIES.length);
  });

  it('iconițele sunt mute, iar eticheta rămâne numele legăturii', () => {
    const { container } = renderAt(<MoreScreen />, '/meniu');

    for (const svg of container.querySelectorAll('svg.icon')) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    }

    for (const entry of MENU_ENTRIES) {
      expect(screen.getByRole('link', { name: label(entry.labelKey) })).toBeInTheDocument();
    }
  });

  it('săgeata de rând e tot un desen, nu caracterul „›"', () => {
    const { container } = renderAt(<MoreScreen />, '/meniu');

    const sageti = container.querySelectorAll('.more-item__chevron');
    expect(sageti).toHaveLength(MENU_ENTRIES.length);
    for (const sageata of sageti) {
      expect(sageata.tagName.toLowerCase()).toBe('svg');
    }

    // Niciun rând nu mai conține glife decorative de text.
    expect(container.textContent).not.toMatch(/[›◎★☺❖▣✦⊘⚙✉≡♥]/);
  });
});
