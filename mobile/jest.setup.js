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
