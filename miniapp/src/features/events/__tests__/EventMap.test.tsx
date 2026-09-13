/**
 * Harta evenimentului.
 *
 * Aici NU mockăm `leaflet`: ecranele o fac, ca să nu depindă de layout-ul din
 * jsdom, dar harta însăși trebuie verificată cu biblioteca adevărată — altfel
 * n-am ști niciodată dacă importul bundlat (`import * as L from 'leaflet'` +
 * CSS-ul din pachet) chiar se încarcă.
 *
 * Accentul cade pe ramura FĂRĂ coordonate: e singura pe care utilizatorul o
 * vede des (backendul are `lat`/`lng` opționale) și singura care trebuie să
 * arate ceva util — orașul — în loc de o casetă goală.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

// Componenta își ia etichetele de accesibilitate din catalog, iar aici nu
// folosim `renderWithProviders` (harta trebuie testată cu Leaflet-ul adevărat,
// fără cadrul de React Query). Importul inițializează instanța i18n, altfel
// `useTranslation` ar întoarce cheia în locul textului.
import '@/i18n';

import { EventMap, hasValidCoords } from '../EventMap';

describe('hasValidCoords', () => {
  it('acceptă doar numere finite în intervalele geografice', () => {
    expect(hasValidCoords(47.0245, 28.8322)).toBe(true);
    expect(hasValidCoords(0, 0)).toBe(true);
    expect(hasValidCoords(-90, 180)).toBe(true);
  });

  it('respinge lipsa, non-numerele și valorile în afara intervalelor', () => {
    expect(hasValidCoords(undefined, undefined)).toBe(false);
    expect(hasValidCoords(null, null)).toBe(false);
    expect(hasValidCoords(47.0245, undefined)).toBe(false);
    expect(hasValidCoords(undefined, 28.8322)).toBe(false);
    expect(hasValidCoords(Number.NaN, 10)).toBe(false);
    expect(hasValidCoords(10, Number.POSITIVE_INFINITY)).toBe(false);
    expect(hasValidCoords(91, 10)).toBe(false);
    expect(hasValidCoords(10, -181)).toBe(false);
  });
});

describe('caseta de rezervă, fără coordonate', () => {
  it('arată orașul în loc de o hartă goală', () => {
    render(<EventMap title="Flirt Party Chișinău" city="Chișinău" />);

    const fallback = screen.getByTestId('event-map-fallback');
    expect(fallback).toHaveTextContent('📍 Chișinău');
    expect(fallback).toHaveAttribute('aria-label', 'Locație: Chișinău');

    // Harta propriu-zisă nu se montează deloc.
    expect(screen.queryByTestId('event-map')).not.toBeInTheDocument();
  });

  it('fără oraș, anunță onest că locația lipsește', () => {
    render(<EventMap lat={null} lng={null} />);

    expect(screen.getByTestId('event-map-fallback')).toHaveAttribute(
      'aria-label',
      'Locație indisponibilă',
    );
  });
});

describe('harta reală', () => {
  it('montează Leaflet cu atribuția OSM și se curăță la demontare', () => {
    const { container, unmount } = render(
      <EventMap lat={47.0245} lng={28.8322} title="Flirt Party Chișinău" city="Chișinău" />,
    );

    expect(screen.getByTestId('event-map')).toHaveAttribute(
      'aria-label',
      'Harta locației: Flirt Party Chișinău',
    );

    // Leaflet și-a luat containerul în primire…
    const canvas = container.querySelector('.ev-map__canvas');
    expect(canvas).toHaveClass('leaflet-container');

    // …iar atribuția OpenStreetMap e pe ecran: e obligatorie prin licența ODbL.
    expect(container.querySelector('.leaflet-control-attribution')?.textContent).toContain(
      'OpenStreetMap',
    );

    // Markerul e un cerc SVG cu clasa noastră — nu un `L.marker` implicit, care
    // ar fi cerut fișiere PNG rupte de bundling.
    expect(container.querySelector('path.ev-map__marker')).not.toBeNull();

    // `map.remove()` la demontare: panourile Leaflet dispar din container. Fără
    // el ar rămâne ascultători pe `window` agățați de un DOM inexistent.
    expect(canvas?.querySelector('.leaflet-map-pane')).not.toBeNull();
    unmount();
    expect(canvas?.querySelector('.leaflet-map-pane')).toBeNull();
  });
});
