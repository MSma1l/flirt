/**
 * Harta locului unui eveniment — Leaflet REAL, direct în DOM-ul Mini App-ului.
 *
 * DE CE NU PORTĂM VARIANTA WEB DIN MOBIL (`<iframe>` spre openstreetmap.org):
 * politica CSP servită paginii Mini App (`backend/nginx/nginx.conf`, blocul
 * Mini App) începe cu `default-src 'self'`, iar `frame-src` nu e declarat
 * separat — deci moștenește `default-src` și un iframe către un alt origin ar fi
 * BLOCAT, în tăcere, cu o casetă goală pe ecran.
 *
 * Varianta de aici trece prin CSP fără nicio modificare de nginx:
 *   - `leaflet` e importat ca modul și BUNDLED de Vite ⇒ scriptul e servit de pe
 *     originul propriu ⇒ acoperit de `script-src 'self'`;
 *   - `leaflet/dist/leaflet.css` intră tot în bundle ⇒ `style-src 'self'`
 *     (stilurile inline pe care Leaflet le pune pe straturi sunt acoperite de
 *     `'unsafe-inline'`, deja prezent);
 *   - dalele OSM sunt `<img>` de pe `https://tile.openstreetmap.org` ⇒ permise
 *     de `img-src 'self' https: data: blob:`.
 * Deci: NICIO schimbare de CSP / nginx nu e necesară.
 *
 * DE CE `circleMarker` ȘI NU `L.marker`: markerul implicit al Leaflet își ia
 * iconița din trei fișiere PNG (`marker-icon.png`, `marker-icon-2x.png`,
 * `marker-shadow.png`) pe care le rezolvă din calea CSS-ului, la runtime. După
 * bundling, CSS-ul ajunge sub `/assets/…` cu hash în nume, iar PNG-urile NU sunt
 * importate de nimeni ⇒ 404 și marker invizibil. `circleMarker` desenează un
 * cerc SVG: zero asset-uri, zero configurări de `L.Icon.Default`. Culoarea lui
 * vine dintr-o clasă CSS (`ev-map__marker`), nu din opțiuni cu valori fixe, ca
 * să rămână legată de variabilele temei.
 *
 * Fără coordonate valide, cade elegant pe caseta cu orașul — exact ca pe mobil.
 */
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import * as L from 'leaflet';

import 'leaflet/dist/leaflet.css';
import './events.css';

/** Dalele OpenStreetMap: gratuite, fără cheie API și fără cont. */
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Atribuția e OBLIGATORIE prin licența ODbL a OpenStreetMap — nu o scoate. */
const ATTRIBUTION = '© OpenStreetMap contributors';

/** Nivel stradă/cvartal: destul cât să recunoști locul, fără a arăta tot orașul. */
const ZOOM = 15;

export interface EventMapProps {
  /** Latitudinea evenimentului (grade zecimale). */
  lat?: number | null;
  /** Longitudinea evenimentului (grade zecimale). */
  lng?: number | null;
  /** Titlul evenimentului, afișat în popup-ul markerului. */
  title?: string;
  /** Text afișat în caseta de rezervă când lipsesc coordonatele (orașul). */
  city?: string;
}

/**
 * Verifică dacă perechea de coordonate e utilizabilă (numere finite, în
 * intervalele valide). PORT 1:1 din `mobile/src/features/events/EventMap.tsx`:
 * backendul are `lat`/`lng` opționale, iar un `0/0` „gol" ar duce harta în
 * Golful Guineei în loc să arate onest că locul nu e cunoscut.
 */
export function hasValidCoords(lat?: number | null, lng?: number | null): boolean {
  return (
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lng === 'number' &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180
  );
}

export function EventMap({ lat, lng, title, city }: EventMapProps) {
  const { t } = useTranslation('screens');
  const containerRef = useRef<HTMLDivElement>(null);
  const valid = hasValidCoords(lat, lng);

  useEffect(() => {
    const container = containerRef.current;
    // Verificarea pe tipuri (nu doar `valid`) e cea care îngustează `lat`/`lng`
    // la `number` pentru TypeScript; `hasValidCoords` rămâne regula de conținut.
    if (!container || typeof lat !== 'number' || typeof lng !== 'number') return;
    if (!hasValidCoords(lat, lng)) return;

    const map = L.map(container, {
      center: [lat, lng],
      zoom: ZOOM,
      // Mini App-ul e un ecran care se derulează: rotița peste hartă trebuie să
      // deruleze pagina, nu să schimbe zoom-ul sub degetul utilizatorului.
      scrollWheelZoom: false,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);

    const marker = L.circleMarker([lat, lng], {
      radius: 9,
      className: 'ev-map__marker',
    }).addTo(map);

    if (title) {
      // Element de DOM cu `textContent`, niciodată `innerHTML`: titlul vine de
      // la server și nu are voie să injecteze markup în popup.
      const label = document.createElement('span');
      label.textContent = title;
      marker.bindPopup(label);
    }

    // Harta își pune ascultători pe `window` (resize) și un `<canvas>`/`<svg>`
    // propriu. Fără `remove()` la demontare, ele rămân agățate de un container
    // care nu mai există — scurgere de memorie la fiecare intrare pe ecran.
    return () => {
      map.remove();
    };
  }, [lat, lng, title]);

  if (!valid) {
    return (
      <div
        className="ev-map ev-map--fallback"
        role="img"
        aria-label={
          city ? t('events.map.location', { city }) : t('events.map.locationUnavailable')
        }
        data-testid="event-map-fallback"
      >
        <span className="ev-map__city">📍 {city}</span>
      </div>
    );
  }

  return (
    <div
      className="ev-map"
      role="img"
      aria-label={title ? t('events.map.titled', { title }) : t('events.map.untitled')}
      data-testid="event-map"
    >
      <div className="ev-map__canvas" ref={containerRef} />
    </div>
  );
}

export default EventMap;
