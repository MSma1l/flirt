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
