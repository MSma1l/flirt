/**
 * Config Metro — o singură abatere de la implicit, explicată mai jos.
 *
 * PROBLEMA (pe WEB, aplicația nu pornea DELOC):
 *   Uncaught SyntaxError: Cannot use 'import.meta' outside a module
 *
 * `zustand` (4.x) își publică `exports` cu mai multe condiții:
 *   - `react-native` → `./index.js`      (CommonJS, curat)
 *   - `import`       → `./esm/index.mjs` (ESM, conține `import.meta.env`)
 * Pe nativ, Metro alege condiția `react-native` și totul e în regulă. Pe web NU
 * există condiția aceea, deci alege `import` → `import.meta` ajunge în bundle,
 * browserul îl încarcă drept script clasic și tot bundle-ul crapă la parsare.
 * Nu e o eroare de rulare pe care s-o vezi într-un ecran: pagina rămâne albă.
 *
 * DE CE AICI și nu prin dezactivarea globală a `package exports`: aceea e
 * implicită în Expo SDK 54 și alte pachete se bazează pe ea. Coborâm condiția
 * DOAR pentru zustand, DOAR pe web — restul rezolvării rămâne neatinsă.
 *
 * De ce nu prinde Jest problema: testele rulează în Node, nu prin Metro. Deci
 * modificarea asta se verifică rulând efectiv bundle-ul web.
 */
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isZustand = moduleName === 'zustand' || moduleName.startsWith('zustand/');

  if (platform === 'web' && isZustand) {
    // Fără `exports`, Metro cade pe `main` — build-ul CommonJS, fără `import.meta`.
    return context.resolveRequest(
      { ...context, unstable_enablePackageExports: false },
      moduleName,
      platform,
    );
  }

  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
