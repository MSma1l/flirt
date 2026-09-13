/**
 * Prinde textele care se întorc ÎN COD, în română, în ecranele acoperite de
 * catalogul `screens`.
 *
 * DE CE EXISTĂ: limba se ia automat din Telegram, deci un singur șir uitat în
 * cod face ca un utilizator rus sau englez să vadă românește. Testul de paritate
 * din `catalogs.test.ts` păzește cataloagele; ăsta păzește sursa.
 *
 * CE ACOPERĂ (pragmatic, nu exhaustiv):
 *  - conținutul literalelor de șir (`'…'`, `"…"`, `` `…` ``), deci și valorile
 *    de atribut: `aria-label`, `title`, `placeholder`, `alt`, `body`-ul
 *    confirmărilor;
 *  - textul scris direct între etichete JSX (`<span>Mergi</span>`).
 *
 * CE NU ACOPERĂ, deliberat, ca să nu dea alarme false:
 *  - COMENTARIILE (`//`, `/* *\/`, `{/* *\/}`) — sunt scoase înainte de analiză;
 *    documentația din fișierele astea e în română și trebuie să rămână așa;
 *  - numele de identificatori, de clase CSS, de `data-testid`, cheile de query:
 *    sunt ASCII englezesc și nu trec de filtrele de mai jos;
 *  - liniile de `import`;
 *  - textul construit prin concatenare din bucăți fără diacritice și fără
 *    cuvinte din listă (ex. `'Ok'`) — un astfel de text ar scăpa. Limita e
 *    asumată: alternativa (un parser complet de TSX) ar costa mult mai mult
 *    decât aduce;
 *  - textul venit de la SERVER (descrieri de eveniment, `detail`-ul FastAPI,
 *    glumele). Acela nu e „hardcodat" — se traduce pe server, nu aici;
 *  - testele (`__tests__/`): ele AFIRMĂ texte românești, e treaba lor.
 *
 * DOUĂ SITE DE DETECȚIE, aplicate doar candidaților de mai sus:
 *  1. diacritice românești — prinde aproape tot;
 *  2. o listă de cuvinte românești FĂRĂ diacritice („Mergi", „Concert",
 *     „Copiat"), pe care sita 1 nu le-ar vedea.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Folderele acoperite de catalogul `screens`. */
const OWNED_FEATURES = [
  'events',
  'loyalty',
  'stories',
  'humor',
  'subscription',
  'tickets',
  'social',
  'passport',
  // Verificarea prin selfie: ecran nou, cu texte în `verification` (cataloagele
  // mobile) și în `screens`. Intră în plasă de la început, nu după prima scăpare.
  'verification',
];

/**
 * Rădăcina surselor. NU se poate deduce din `import.meta.url`: sub jsdom, vitest
 * servește modulele pe `http://localhost/…`, iar `fileURLToPath` ar arunca. Deci
 * pornim din directorul de lucru și urcăm până dăm de `src/features` — merge și
 * când testul e rulat din rădăcina repo-ului.
 */
function featuresDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const candidate = resolve(dir, 'src/features');
    if (existsSync(candidate)) return candidate;
    const miniapp = resolve(dir, 'miniapp/src/features');
    if (existsSync(miniapp)) return miniapp;
    dir = dirname(dir);
  }
  throw new Error(`Nu am găsit „src/features" pornind din ${process.cwd()}`);
}

const FEATURES_DIR = featuresDir();

/** Diacriticele românești, în ambele codări (virgulă și sedilă). */
const ROMANIAN_DIACRITICS = /[ăâîșțĂÂÎȘȚşţŞŢ]/;

/**
 * Cuvinte românești care se scriu FĂRĂ diacritice și care au apărut chiar în
 * ecranele astea. Lista e scurtă intenționat: sunt cuvinte care nu apar în
 * engleză și nici în identificatori, deci nu produc alarme false.
 */
const ROMANIAN_WORDS = [
  'acum',
  'adauga',
  'aici',
  'alege',
  'anulat',
  'bilet',
  'bilete',
  'cont',
  'copiat',
  'deschide',
  'este',
  'eveniment',
  'evenimente',
  'expirat',
  'inapoi',
  'incearca',
  'mergi',
  'mesaj',
  'mesaje',
  'multumim',
  'pentru',
  'poza',
  'poze',
  'profil',
  'salveaza',
  'setari',
  'sterge',
  'trimis',
  'vezi',
];

const ROMANIAN_WORDS_RE = new RegExp(`\\b(${ROMANIAN_WORDS.join('|')})\\b`, 'i');

/**
 * Texte care AU voie să rămână în cod: nume proprii, mărci, simboluri. Se
 * compară exact, după `trim()`, ca lista să nu devină o portiță largă.
 */
const ALLOWED_TEXTS = new Set([
  'FLIRT',
  'Flirt Party',
  'Flirt Passport',
  // Fragmente din `detail`-ul SERVERULUI, nu texte de interfață. Backendul
  // deosebește cele trei cazuri de 409 la folosirea unei invitații (revocată /
  // expirată / epuizată) doar prin mesajul în română din
  // `backend/app/services/loyalty.py`, fără un cod stabil de eroare; ca să le
  // putem trata distinct, `features/loyalty/loyaltyErrors.ts` potrivește pe
  // aceste bucăți. Sunt trecute una câte una, exact, tocmai ca portița să
  // rămână îngustă: o propoziție de interfață nu arată niciodată așa.
  'anulat',
  'expirat',
]);

interface Finding {
  file: string;
  line: number;
  text: string;
}

/** Fișierele de sursă (fără teste) din folderele acoperite. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) out.push(full);
    }
  };
  for (const feature of OWNED_FEATURES) walk(join(FEATURES_DIR, feature));
  return out.sort();
}

/**
 * Un mini-scanner de caractere, nu o expresie regulată: `'https://…'` conține
 * `//`, iar o regulă naivă de scos comentariile ar tăia jumătate din șiruri.
 * Scannerul știe în ce stare e (cod / șir / comentariu), deci nu se încurcă.
 *
 * Întoarce conținutul literalelor de șir ȘI codul rămas fără comentarii și fără
 * șiruri — din el se extrage apoi textul JSX.
 */
function scan(source: string): { strings: Finding[]; stripped: string } {
  const strings: Finding[] = [];
  const stripped: string[] = [];
  let line = 1;
  let i = 0;

  const push = (ch: string) => {
    stripped.push(ch === '\n' ? '\n' : ch);
  };

  while (i < source.length) {
    const ch = source[i] as string;
    const next = source[i + 1];

    if (ch === '\n') {
      line += 1;
      push('\n');
      i += 1;
      continue;
    }

    // Comentariu de linie.
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }

    // Comentariu bloc (inclusiv cel din `{/* … */}`).
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') line += 1;
        i += 1;
      }
      i += 2;
      continue;
    }

    // Literal de șir; la template, păstrăm doar bucățile literale.
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      const startLine = line;
      let value = '';
      let depth = 0;
      i += 1;
      while (i < source.length) {
        const c = source[i] as string;
        if (c === '\\') {
          value += source[i + 1] ?? '';
          i += 2;
          continue;
        }
        if (c === '\n') line += 1;
        if (quote === '`' && c === '$' && source[i + 1] === '{') {
          // Interpolarea e cod, nu text: îi sărim conținutul, numărând acoladele.
          depth = 1;
          i += 2;
          while (i < source.length && depth > 0) {
            if (source[i] === '{') depth += 1;
            else if (source[i] === '}') depth -= 1;
            else if (source[i] === '\n') line += 1;
            i += 1;
          }
          continue;
        }
        if (c === quote) {
          i += 1;
          break;
        }
        value += c;
        i += 1;
      }
      strings.push({ file: '', line: startLine, text: value });
      push(' ');
      continue;
    }

    push(ch);
    i += 1;
  }

  return { strings, stripped: stripped.join('') };
}

/** Textul scris direct între etichete JSX, cu numărul liniei lui. */
function jsxTexts(stripped: string): Finding[] {
  const found: Finding[] = [];
  const re = />([^<>{}]+)</g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stripped)) !== null) {
    const text = (match[1] ?? '').trim();
    if (!text) continue;
    const line = stripped.slice(0, match.index).split('\n').length;
    found.push({ file: '', line, text });
  }
  return found;
}

/** Textul pare scris în română pentru un om? */
function looksRomanian(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 3) return false;
  if (ALLOWED_TEXTS.has(trimmed)) return false;
  // Un identificator, o cale sau o clasă CSS nu conține spații și nici
  // diacritice; le lăsăm în seama celor două site de mai jos.
  if (ROMANIAN_DIACRITICS.test(trimmed)) return true;
  return ROMANIAN_WORDS_RE.test(trimmed);
}

describe('texte scrise în cod', () => {
  const findings: Finding[] = [];

  for (const file of sourceFiles()) {
    const source = readFileSync(file, 'utf8');
    const { strings, stripped } = scan(source);
    const relative = file.slice(FEATURES_DIR.length + 1);

    for (const candidate of [...strings, ...jsxTexts(stripped)]) {
      if (looksRomanian(candidate.text)) {
        findings.push({ ...candidate, file: relative });
      }
    }
  }

  it('scanează chiar fișierele ecranelor (plasa nu e goală)', () => {
    // Fără asta, o cale greșită ar face testul să treacă pe zero fișiere.
    expect(sourceFiles().length).toBeGreaterThan(15);
  });

  it('nu lasă niciun text românesc în sursa ecranelor', () => {
    expect(findings).toEqual([]);
  });
});
