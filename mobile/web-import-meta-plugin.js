/**
 * Plugin Babel minimal, folosit DOAR la build-ul web (preview în browser).
 *
 * Bundle-ul web e servit ca script clasic (`<script src=...>`, fără
 * `type="module"`), iar orice `import.meta` din el e eroare de PARSARE —
 * „Cannot use 'import.meta' outside a module" — care albește toată pagina.
 * Îl emit atât unele pachete în varianta ESM (ex. `zustand` → `import.meta.env`),
 * cât și infrastructura internă Expo (`import.meta.url`).
 *
 * `babel-plugin-transform-import-meta` acoperă doar `import.meta.url`, nu și
 * `.env`. Aici înlocuim NODUL `import.meta` întreg (MetaProperty) cu un obiect
 * inofensiv `{ url: '', env: {} }`, deci toate accesele (`.url`, `.env`, `.env.MODE`)
 * devin valori definite, iar codul cade pe ramurile de dev. Nu se aplică pe nativ.
 */
module.exports = function stripImportMeta({ types: t }) {
  return {
    name: 'web-strip-import-meta',
    visitor: {
      MetaProperty(path) {
        path.replaceWith(
          t.objectExpression([
            t.objectProperty(t.identifier('url'), t.stringLiteral('')),
            t.objectProperty(t.identifier('env'), t.objectExpression([])),
          ]),
        );
      },
    },
  };
};
