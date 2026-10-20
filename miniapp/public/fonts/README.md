# Fonturi gazduite local

`manrope-*-wght-normal.woff2` — Manrope, varianta variabila (axa `wght` 200-800),
subseturile latin, latin-ext (diacriticele romanesti) si cyrillic.

- Sursa: pachetul npm `@fontsource-variable/manrope@5.2.8`
  (https://cdn.jsdelivr.net/npm/@fontsource-variable/manrope@5.2.8/files/), fisiere nemodificate.
- Licenta: SIL Open Font License 1.1 — textul complet in `OFL.txt`.
  Copyright 2019 The Manrope Project Authors (https://github.com/sharanda/manrope).
- `@font-face`: `src/styles/fonts.css`; preload pentru subsetul latin in `index.html`.

De ce local: CSP-ul Mini App-ului (`font-src 'self' data:`) blocheaza Google Fonts.
