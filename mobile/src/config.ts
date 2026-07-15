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
  photoMinCount?: number;
  photoMaxCount?: number;
  photoMaxUploadBytes?: number;
  photoAllowedTypes?: string[];
  photoMaxDimension?: number;
  photoCompressQuality?: number;
  photoMinCompressQuality?: number;
  iapProductIds?: Record<string, string>;
  googleAuthClientIdIos?: string;
  googleAuthClientIdAndroid?: string;
  googleAuthClientIdWeb?: string;
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
    termsUrl: extra.termsUrl ?? 'https://api.flrt.md/legal/terms',
    /** Politica de confidențialitate. */
    privacyUrl: extra.privacyUrl ?? 'https://api.flrt.md/legal/privacy',
    /** Pagina de suport / contact pentru utilizatori. */
    supportUrl: extra.supportUrl ?? 'https://api.flrt.md/legal/support',
  },

  /**
   * In-App Purchase (StoreKit 2 / Play Billing). Cheia e codul planului din
   * catalogul backend-ului (`PLANS`), valoarea e ID-ul produsului din App Store
   * Connect. Apple NU acceptă alt canal de plată pentru conținut digital
   * (Guideline 3.1.1) — de aceea nu există niciun Stripe pe ecranul de abonament.
   *
   * ID-urile trebuie să fie IDENTICE cu cele definite în App Store Connect. Dacă
   * nu se potrivesc, magazinul întoarce pur și simplu zero produse și paywall-ul
   * rămâne gol — de aceea `iap.ts` raportează explicit produsele lipsă în loc să
   * eșueze mut.
   */
  iap: {
    productIds: extra.iapProductIds ?? {},
  },

  /**
   * Login social. Backend-ul verifică deja token-urile prin JWKS-ul real (Google
   * + Apple); aici stau doar ID-urile de client necesare pe dispozitiv.
   *
   * Guideline 4.8: dacă aplicația oferă login prin Google, „Sign in with Apple"
   * devine OBLIGATORIU. Nu există varianta „doar Google" — de aceea ecranul le
   * arată pe amândouă sau pe niciuna (vezi `socialAuth.ts`).
   *
   * Apple nu are nevoie de un client ID pe iOS (folosește bundle identifier-ul).
   */
  googleAuth: {
    clientIdIos: extra.googleAuthClientIdIos ?? '',
    clientIdAndroid: extra.googleAuthClientIdAndroid ?? '',
    clientIdWeb: extra.googleAuthClientIdWeb ?? '',
  },

  /**
   * Poze de profil (TZ 2.4). Valorile implicite sunt SIMETRICE cu backend-ul
   * (`app/core/config.py`: min_photos=1, max_photos=9, max_upload_bytes=8 MB,
   * allowed_image_types) — dacă backend-ul își schimbă limitele, se suprascriu
   * din `app.json` → `expo.extra.photo*`, fără a atinge codul ecranelor.
   *
   * `maxDimension` + `compressQuality` sunt EXCLUSIV client-side: o poză făcută
   * cu un telefon modern are 5–12 MB și ar fi respinsă de backend (413), deci o
   * redimensionăm și o recomprimăm ÎNAINTE de upload. `minCompressQuality` e
   * pragul sub care nu mai coborâm calitatea — dacă nici acolo poza nu intră în
   * limită, o respingem cu un mesaj clar, nu trimitem degeaba.
   */
  photos: {
    /** Numărul minim de poze cerut de anketă (backend: `min_photos`). */
    min: extra.photoMinCount ?? 1,
    /** Numărul maxim de poze pe profil (backend: `max_photos`). */
    max: extra.photoMaxCount ?? 9,
    /** Dimensiunea maximă a unui fișier (backend: `max_upload_bytes` = 8 MB). */
    maxUploadBytes: extra.photoMaxUploadBytes ?? 8_388_608,
    /** Tipurile MIME acceptate (backend: `allowed_image_types`). */
    allowedTypes: (extra.photoAllowedTypes ?? [
      'image/jpeg',
      'image/png',
      'image/webp',
    ]) as readonly string[],
    /** Latura maximă (px) după redimensionare, înainte de upload. */
    maxDimension: extra.photoMaxDimension ?? 1920,
    /** Calitatea inițială de compresie JPEG (0–1). */
    compressQuality: extra.photoCompressQuality ?? 0.8,
    /** Calitatea minimă acceptată la recompresie (0–1). */
    minCompressQuality: extra.photoMinCompressQuality ?? 0.4,
    /** Pasul cu care scădem calitatea dacă poza tot depășește limita. */
    compressQualityStep: 0.2,
  },
};
