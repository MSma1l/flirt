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

/**
 * URL-ul API. Sursa de adevăr e variabila de mediu `EXPO_PUBLIC_API_URL`, setată
 * per profil în `eas.json` și inline-uită în bundle la build de babel-preset-expo.
 *
 * NU mai există un `localhost` hardcodat pentru build-urile reale: pe un telefon
 * fizic `localhost` nu există, iar App Transport Security blochează HTTP cleartext,
 * deci un build de producție care ar cădea pe localhost ar avea EROARE DE REȚEA pe
 * fiecare ecran (respingere sigură pe Guideline 2.1).
 *
 * Ordinea: variabila de mediu → `extra.apiUrl` din app.json (override local/teste)
 * → fallback localhost DOAR în development. În producție, lipsa variabilei sau un
 * URL non-HTTPS opresc aplicația imediat, ca greșeala să iasă la iveală în timpul
 * testării interne, nu în fața recenzentului Apple.
 */
function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (fromEnv) return fromEnv;

  const fromExtra = extra.apiUrl?.trim();
  if (fromExtra) return fromExtra;

  if (__DEV__) return 'http://localhost:8000/api/v1';

  throw new Error(
    'EXPO_PUBLIC_API_URL lipsește din build-ul de producție. ' +
      'Setează-l în eas.json (profilul `production`) înainte de build.',
  );
}

const apiUrl = resolveApiUrl();

if (!__DEV__ && !apiUrl.startsWith('https://')) {
  throw new Error(
    `EXPO_PUBLIC_API_URL trebuie să fie HTTPS în producție (primit: ${apiUrl}). ` +
      'App Transport Security blochează HTTP cleartext pe device-uri reale.',
  );
}

export const config = {
  apiUrl,

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
