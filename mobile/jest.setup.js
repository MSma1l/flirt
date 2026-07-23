// Iconițe vectoriale: `@expo/vector-icons` trage după el `expo-font` →
// `expo-asset`, care nu e instalat și nu poate fi rezolvat în jest. Nu ne
// interesează glyph-ul real în teste — doar că iconița se randează — așa că o
// înlocuim cu un `Text` care păstrează props-urile (name/testID/accessibility).
// Fără asta, ORICE test care importă bara de taburi sau `@/components/ui`
// (unde stă `BackButton`) ar pica la import.
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const makeIcon = () => (props) =>
    React.createElement(Text, { ...props }, props.name);
  return {
    Ionicons: makeIcon(),
  };
});

// `react-native-qrcode-svg` trage după el `react-native-svg` (nativ), care
// încetinește/atârnă jest. Nu ne interesează SVG-ul real în teste — doar că
// QR-ul primește codul — așa că îl înlocuim cu un `Text` ce expune `value`.
jest.mock('react-native-qrcode-svg', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return function MockQRCode({ value }) {
    return React.createElement(Text, { testID: 'qr-value' }, value);
  };
});

// `@react-native-community/datetimepicker` are parte nativă (nu există în jest).
// Îl înlocuim cu un `Pressable` inert care, la apăsare, simulează alegerea unei
// date (event `set`) — testele pot astfel exercita fluxul de selecție fără UI
// nativ. Data simulată e fixă și adultă (15.01.2000), sub pragul maxim de 18+.
jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    __esModule: true,
    default: function MockDateTimePicker(props) {
      return React.createElement(
        Pressable,
        {
          testID: props.testID || 'birthdate-picker',
          onPress: () => props.onChange?.({ type: 'set' }, new Date(2000, 0, 15)),
        },
        React.createElement(Text, null, 'date-picker'),
      );
    },
  };
});

// `react-native-country-flag` randează steagul ca imagine remotă (flagcdn.com).
// În teste nu ne interesează pixelii, doar CE steag se cere — îl înlocuim cu un
// `Text` ce expune `isoCode`, ca testele să verifice țara aleasă.
jest.mock('react-native-country-flag', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: function MockCountryFlag({ isoCode }) {
      return React.createElement(Text, { testID: `flag-${isoCode}` }, isoCode);
    },
  };
});

// Setup global de teste. Mock pentru SecureStore (nu există nativ în jest).
jest.mock('expo-secure-store', () => {
  const store = {};
  return {
    getItemAsync: jest.fn(async (k) => (k in store ? store[k] : null)),
    setItemAsync: jest.fn(async (k, v) => {
      store[k] = v;
    }),
    deleteItemAsync: jest.fn(async (k) => {
      delete store[k];
    }),
  };
});

jest.mock('expo-constants', () => ({
  expoConfig: { extra: { apiUrl: 'http://localhost:8000/api/v1' } },
}));

// i18n: limba dispozitivului e fixată pe română, ca testele să fie
// deterministe indiferent de mașina pe care rulează (CI, laptop rusificat etc.).
// Un test care vrea altă limbă cheamă `i18n.changeLanguage('ru')` la el în fișier.
// `jest.fn` (nu funcții simple): testele de i18n suprascriu limba dispozitivului
// cu `mockReturnValue` ca să verifice detecția și fallback-ul.
jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [
    { languageCode: 'ro', languageTag: 'ro-MD', regionCode: 'MD', textDirection: 'ltr' },
  ]),
  getCalendars: jest.fn(() => [{ calendar: 'gregory', timeZone: 'Europe/Chisinau' }]),
}));

// Inițializează instanța i18n (sincron, pe `ro`) pentru TOATE testele, ca
// ecranele care folosesc `useTranslation()` să randeze text real, nu chei brute.
// Fără asta, fiecare test de ecran migrat ar trebui să-și facă singur setup —
// exact ce nu vrem când zeci de ecrane se migrează în paralel.
require('@/i18n');

// Poze: modulele native (galerie, compresie, filesystem) nu există în jest.
// Valorile implicite descriu cazul fericit — permisiune acordată, poză mică —
// iar testele care au nevoie de alt scenariu (refuz, poză uriașă) suprascriu
// aceste mock-uri local, cu `jest.mock` în fișierul lor.
jest.mock('expo-image-picker', () => ({
  getMediaLibraryPermissionsAsync: jest.fn(async () => ({
    granted: true,
    canAskAgain: true,
    status: 'granted',
  })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({
    granted: true,
    canAskAgain: true,
    status: 'granted',
  })),
  launchImageLibraryAsync: jest.fn(async () => ({
    canceled: true,
    assets: null,
  })),
}));

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(async (uri) => ({ uri, width: 1920, height: 1440 })),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
}));

jest.mock('expo-file-system', () => ({
  File: class MockFile {
    constructor(uri) {
      this.uri = uri;
      // 1 MB — sub limita de upload; testele de poze mari suprascriu mock-ul.
      this.size = 1024 * 1024;
    }
  },
}));

// Push: modulele native (expo-notifications, expo-device) nu există în jest.
// Implicit simulăm un SIMULATOR fără permisiune acordată — adică EXACT cazul în
// care serviciul de push nu atinge nici rețeaua, nici backend-ul. Ecranele care
// îl importă rămân astfel curate, iar testele de push suprascriu local mock-ul
// (jest.mock la nivel de fișier are prioritate) pentru scenariile lor.
jest.mock('expo-device', () => ({ isDevice: false }));

jest.mock('expo-notifications', () => ({
  AndroidImportance: { MIN: 1, LOW: 2, DEFAULT: 3, HIGH: 4, MAX: 5 },
  IosAuthorizationStatus: {
    NOT_DETERMINED: 0,
    DENIED: 1,
    AUTHORIZED: 2,
    PROVISIONAL: 3,
    EPHEMERAL: 4,
  },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({
    granted: false,
    canAskAgain: true,
    status: 'undetermined',
  })),
  requestPermissionsAsync: jest.fn(async () => ({
    granted: false,
    canAskAgain: true,
    status: 'denied',
  })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test]', type: 'expo' })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  dismissAllNotificationsAsync: jest.fn(async () => undefined),
  setBadgeCountAsync: jest.fn(async () => true),
}));

// react-native-webview ≥13.15 cere un TurboModule nativ chiar la import
// (TurboModuleRegistry.getEnforcing), care nu există în jest. Îl înlocuim cu o
// componentă inertă: logica hărții (validarea coordonatelor, HTML-ul Leaflet) e
// testată direct pe funcțiile pure din EventMap, nu prin randarea nativă.
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    WebView: React.forwardRef((props, ref) => React.createElement(View, { ...props, ref })),
  };
});

// Izolare de platformă între teste. Unele teste mută `Platform.OS` (ex. la 'web')
// ca să verifice degradarea web. În `--runInBand` modulul react-native e partajat
// între fișiere, deci o mutare nerestaurată se scurge în fișierul următor și rupe
// intermitent testele sensibile la platformă (ex. ecranul de story cu cameră).
// Capturăm valoarea implicită O SINGURĂ DATĂ (înainte de orice mutare) și o
// restaurăm după FIECARE test, în toate fișierele. Deterministic, fără flakiness.
const { Platform: __RNPlatform } = require('react-native');
if (global.__ORIGINAL_PLATFORM_OS === undefined) {
  global.__ORIGINAL_PLATFORM_OS = __RNPlatform.OS;
}
afterEach(() => {
  if (__RNPlatform.OS !== global.__ORIGINAL_PLATFORM_OS) {
    Object.defineProperty(__RNPlatform, 'OS', {
      value: global.__ORIGINAL_PLATFORM_OS,
      configurable: true,
      writable: true,
    });
  }
});
