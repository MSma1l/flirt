module.exports = function (api) {
  // Web-ul (preview în browser) cere transformarea lui `import.meta`, pe care
  // unele pachete îl emit în varianta ESM (ex. zustand) și pe care infrastructura
  // Expo îl folosește intern — sintaxă invalidă într-un bundle clasic de browser,
  // deci pagina cade cu „Cannot use 'import.meta' outside a module".
  //
  // Gate DETERMINIST printr-o variabilă proprie, setată DOAR când pornim web-ul
  // (`WEB_BUILD=1 npx expo start --web`). Build-urile native / EAS NU o setează,
  // deci pe hermes `import.meta` rămâne neatins (nu intră în conflict cu
  // polyfill-ul intern Expo). `api.caller(platform)` s-a dovedit inconsistent
  // între contextele de transform ale Metro, de aceea nu ne bazăm pe el.
  const isWeb = process.env.WEB_BUILD === '1';
  api.cache.using(() => process.env.WEB_BUILD || 'native');

  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ...(isWeb ? [require.resolve('./web-import-meta-plugin.js')] : []),
      [
        'module-resolver',
        {
          alias: {
            '@': './src',
            '@theme': './theme',
          },
        },
      ],
    ],
  };
};
