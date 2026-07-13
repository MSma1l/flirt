/** Config runtime — citit din app.json → extra (NIMIC hardcodat în ecrane). */
import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  apiUrl?: string;
  mapTileUrl?: string;
  mapAttribution?: string;
  mapZoom?: number;
  mapLeafletCssUrl?: string;
  mapLeafletJsUrl?: string;
  termsUrl?: string;
  privacyUrl?: string;
  supportUrl?: string;
};

export const config = {
  apiUrl: extra.apiUrl ?? 'http://localhost:8000/api/v1',

  /**
   * Hartă: tiles OpenStreetMap prin Leaflet, randate într-un WebView.
   * Gratuit, fără cheie API și fără cont. Suprascriptibil din app.json → extra.
   */
  map: {
    /** Șablonul de tiles ({s}/{z}/{x}/{y} sunt înlocuite de Leaflet). */
    tileUrl: extra.mapTileUrl ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    /** Atribuție obligatorie prin licența OpenStreetMap (ODbL). Nu o elimina. */
    attribution: extra.mapAttribution ?? '© OpenStreetMap contributors',
    /** Nivel de zoom implicit pentru locația unui eveniment (stradă/cvartal). */
    zoom: extra.mapZoom ?? 15,
    /** Leaflet servit din CDN, încărcat doar în interiorul WebView-ului. */
    leafletCssUrl: extra.mapLeafletCssUrl ?? 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    leafletJsUrl: extra.mapLeafletJsUrl ?? 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  },

  /**
   * Documente legale + suport. Sunt OBLIGATORII pentru App Store / Google Play:
   * Guideline 1.2 (safety: termeni cu toleranță zero + contact de suport),
   * 3.1.2 (linkuri ToS/EULA + Privacy pe ecranul de abonament) și
   * 5.1.1 (politică de confidențialitate accesibilă din aplicație).
   *
   * ATENȚIE ÎNAINTE DE SUBMIT: valorile de mai jos sunt doar fallback-uri de
   * dezvoltare. Pune URL-urile publice REALE (pagini live, accesibile fără
   * login) în `app.json` → `expo.extra.termsUrl` / `privacyUrl` / `supportUrl`.
   * Aceleași URL-uri trebuie declarate și în App Store Connect.
   */
  legal: {
    /** Termeni și condiții / EULA (include clauza de toleranță zero). */
    termsUrl: extra.termsUrl ?? 'https://flirt.app/legal/terms',
    /** Politica de confidențialitate. */
    privacyUrl: extra.privacyUrl ?? 'https://flirt.app/legal/privacy',
    /** Pagina de suport / contact pentru utilizatori. */
    supportUrl: extra.supportUrl ?? 'https://flirt.app/support',
  },
};
