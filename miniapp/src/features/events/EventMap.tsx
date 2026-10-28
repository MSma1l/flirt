/**
 * Harta locului unui eveniment — Leaflet REAL, direct în DOM-ul Mini App-ului.
 *
 * DE CE NU PORTĂM VARIANTA WEB DIN MOBIL (`<iframe>` spre openstreetmap.org):
 * politica CSP servită paginii Mini App (`deploy/k8s/images/web/nginx.conf.template`, blocul
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
 * PIN-UL e un `L.divIcon` cu un SVG STATIC (constantă din cod, zero date de la
 * server în markup), nu `L.marker` cu iconița implicită: aceea își ia PNG-urile
 * din calea CSS-ului la runtime, iar după bundling ele dau 404 (marker
 * invizibil). Culorile pin-ului vin din clase CSS (`ev-map__pin`), legate de
 * variabilele temei.
 *
 * DE CE HARTA IEȘEA CA O FÂȘIE DE 20–40 px (bug raportat de testeri): era copil
 * al unui container flex pe coloană cu `overflow-y: auto` și `overflow: hidden`
 * pe ea însăși ⇒ `min-height: auto` devenea 0 și flex-ul o turtea când pagina
 * avea mult conținut. Acum înălțimea e fixă și `flex-shrink: 0` (`events.css`),
 * iar Leaflet primește `invalidateSize()` după montare și la fiecare
 * redimensionare a containerului (ResizeObserver) — altfel ar fi calculat
 * dalele pe dimensiunea de la primul cadru.
 *
 * DERULAREA PAGINII: pe ecranele tactile tragerea cu un deget NU mută harta
 * (ar fi „capturat" derularea paginii); zoom-ul rămâne cu două degete și cu
 * butoanele +/−. Pentru navigare reală e butonul „Deschide în hărți".
 *
 * Fără coordonate valide, cade elegant pe caseta cu orașul — exact ca pe mobil.
 */
import { useEffect, useRef, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import * as L from 'leaflet';

import { getWebApp } from '@/telegram/bridge';

import { RouteIcon } from './EventIcons';

import 'leaflet/dist/leaflet.css';
import './events.css';

/** Dalele OpenStreetMap: gratuite, fără cheie API și fără cont. */
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Atribuția e OBLIGATORIE prin licența ODbL a OpenStreetMap — nu o scoate. */
const ATTRIBUTION = '© OpenStreetMap contributors';

/** Nivel stradă/cvartal: destul cât să recunoști locul, fără a arăta tot orașul. */
const ZOOM = 15;

/** Pin-ul: SVG static (fără date de la server), colorat din CSS. */
const PIN_HTML =
  '<svg viewBox="0 0 32 42" width="32" height="42" aria-hidden="true" focusable="false">' +
  '<path class="ev-map__pin-body" d="M16 41s14-13.2 14-24.5C30 8 23.7 2 16 2S2 8 2 16.5C2 27.8 16 41 16 41z"/>' +
  '<circle class="ev-map__pin-dot" cx="16" cy="16.5" r="5.5"/>' +
  '</svg>';

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

/**
 * Legătura universală Google Maps: pe telefon deschide aplicația de hărți (dacă
 * e instalată), altfel site-ul — pe Android, iOS și desktop.
 */
export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** În Telegram, legătura externă se deschide prin `openLink` (browserul clientului). */
function openExternal(event: MouseEvent<HTMLAnchorElement>, href: string) {
  const app = getWebApp();
  if (app && typeof app.openLink === 'function') {
    try {
      app.openLink(href);
      event.preventDefault();
    } catch {
      /* lăsăm legătura obișnuită să funcționeze */
    }
  }
}

/** Ecran tactil (telefon/tabletă): tragerea cu un deget derulează pagina. */
function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(L.Browser?.mobile) || window.matchMedia?.('(pointer: coarse)').matches === true;
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

    const touch = isTouchDevice();
    const map = L.map(container, {
      center: [lat, lng],
      zoom: ZOOM,
      // Mini App-ul e un ecran care se derulează: rotița peste hartă trebuie să
      // deruleze pagina, nu să schimbe zoom-ul sub degetul utilizatorului.
      scrollWheelZoom: false,
      // Pe touch, un deget = derularea paginii; harta se mișcă doar cu două
      // degete (pinch) sau din butoane.
      dragging: !touch,
      touchZoom: true,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);

    const marker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'ev-map__pin',
        html: PIN_HTML,
        iconSize: [32, 42],
        // Vârful pin-ului (jos, la mijloc) stă exact pe coordonate.
        iconAnchor: [16, 41],
        popupAnchor: [0, -38],
      }),
      keyboard: false,
    }).addTo(map);

    if (title) {
      // Element de DOM cu `textContent`, niciodată `innerHTML`: titlul vine de
      // la server și nu are voie să injecteze markup în popup.
      const label = document.createElement('span');
      label.textContent = title;
      marker.bindPopup(label);
    }

    // Containerul își primește dimensiunea finală abia după layout (și se poate
    // schimba: rotirea ecranului, tastatura, fontul). Leaflet trebuie anunțat,
    // altfel desenează dalele pe dimensiunea veche — fâșia gri raportată.
    const refit = () => {
      map.invalidateSize?.();
      map.setView?.([lat, lng], map.getZoom?.() ?? ZOOM, { animate: false });
    };
    const frame = window.requestAnimationFrame(refit);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => refit());
      observer.observe(container);
    }

    // Harta își pune ascultători pe `window` (resize) și un `<canvas>`/`<svg>`
    // propriu. Fără `remove()` la demontare, ele rămân agățate de un container
    // care nu mai există — scurgere de memorie la fiecare intrare pe ecran.
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      map.remove();
    };
  }, [lat, lng, title]);

  if (!valid || typeof lat !== 'number' || typeof lng !== 'number') {
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

  const href = mapsUrl(lat, lng);
  return (
    <div className="ev-map-block">
      <div
        className="ev-map"
        role="img"
        aria-label={title ? t('events.map.titled', { title }) : t('events.map.untitled')}
        data-testid="event-map"
      >
        <div className="ev-map__canvas" ref={containerRef} />
      </div>
      <a
        className="ev-map__open"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="event-map-open"
        onClick={(e) => openExternal(e, href)}
      >
        <RouteIcon width={18} height={18} />
        <span>{t('events.map.open')}</span>
      </a>
    </div>
  );
}

export default EventMap;
