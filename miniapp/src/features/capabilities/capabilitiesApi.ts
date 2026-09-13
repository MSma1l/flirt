/**
 * CE POATE FACE SERVERUL CU ADEVĂRAT — stratul de date al capabilităților.
 *
 * DE CE EXISTĂ. Verificarea prin selfie era desfășurată în producție cu
 * providerul `stub` (`backend/app/services/face_verify.py`, `StubFaceVerifier`
 * → întoarce mereu `(True, 99.0)`). Adică badge-ul „Cont verificat" se câștiga
 * apăsând un buton. O insignă de încredere falsă e mai rea decât lipsa ei: strică
 * încrederea în tot ce arată aplicația. Decizia proprietarului: funcția se
 * ASCUNDE cât timp nu e reală.
 *
 * REGULA DE AUR: starea vine de la SERVER, niciodată ghicită pe client. Fără
 * `import.meta.env.DEV`, fără nume de mediu, fără variabilă de build. Serverul
 * știe ce provider are configurat; clientul nu are de unde. O a doua sursă de
 * adevăr s-ar desincroniza tăcut exact în ziua în care contează.
 *
 * STRATUL E GENERAL, nu legat de verificare. Ruta va anunța și alte funcții
 * (notificări push, plăți), iar ele trebuie să se ascundă fără a doua
 * implementare: de aceea harta e `Record<string, boolean>`, iar consumatorul
 * întreabă după nume.
 *
 * ------------------------------------------------------------------------
 * CONTRACTUL. La momentul scrierii, `backend/app/api/v1/capabilities.py` și
 * `backend/app/schemas/capabilities.py` NU existau încă în repo (le construiește
 * alt agent, în paralel). Ca să nu blocăm ascunderea funcției pe o rută care nu
 * s-a născut, parserul de mai jos ACCEPTĂ mai multe forme plauzibile ale
 * aceluiași răspuns și le normalizează la o singură hartă:
 *
 *   {"face_verification": true, "push": false}          — plat, booleene
 *   {"capabilities": {"face_verification": true}}       — într-un container
 *   {"features": {"face_verification": {"enabled": true}}}
 *   {"capabilities": ["push"]}                          — lista celor ACTIVE
 *
 * Nu e „magie": e toleranță deliberată la un contract încă nefixat, ținută
 * într-un singur fișier, cu teste. Când ruta reală ajunge în repo, aici rămâne
 * de tăiat exact o listă (`CONTAINER_KEYS`) și un tabel (`ALIASES`) — restul
 * aplicației nu află nimic.
 * ------------------------------------------------------------------------
 */
import { api } from '@/api/client';

/** Calea rutei, relativă la `config.apiUrl` (care include deja `/api/v1`). */
export const CAPABILITIES_PATH = '/capabilities';

/** Harta normalizată: numele funcției → e disponibilă cu adevărat? */
export type CapabilityMap = Readonly<Record<string, boolean>>;

/**
 * Numele CANONICE, cele pe care le folosește codul aplicației.
 *
 * `push` și `payments` nu au încă niciun consumator: stau aici ca următoarea
 * funcție ascunsă să fie o singură linie în ecranul ei, nu un al doilea strat.
 */
export const CAPABILITY = {
  faceVerification: 'face_verification',
  push: 'push',
  payments: 'payments',
} as const;

export type CapabilityName = (typeof CAPABILITY)[keyof typeof CAPABILITY];

/** Harta goală — „nu știm nimic", deci nimic nu e disponibil. Vezi `isEnabled`. */
export const NO_CAPABILITIES: CapabilityMap = Object.freeze({});

/** Cheile sub care serverul ar putea împacheta harta. */
const CONTAINER_KEYS = ['capabilities', 'features', 'flags'] as const;

/** Câmpurile din care citim steagul când valoarea e un obiect, nu un boolean. */
const FLAG_FIELDS = ['enabled', 'available', 'active', 'is_enabled', 'ready'] as const;

/**
 * Sinonime acceptate → numele canonic.
 *
 * Backendul poate numi funcția `face_verification`, `face_verify` sau simplu
 * `verification`; toate înseamnă același lucru. Tabelul e scurt intenționat și
 * se reduce la o singură intrare când contractul real e cunoscut.
 */
const ALIASES: Readonly<Record<string, CapabilityName>> = {
  face_verification: CAPABILITY.faceVerification,
  face_verify: CAPABILITY.faceVerification,
  facial_verification: CAPABILITY.faceVerification,
  selfie_verification: CAPABILITY.faceVerification,
  photo_verification: CAPABILITY.faceVerification,
  verification: CAPABILITY.faceVerification,
  push: CAPABILITY.push,
  push_notifications: CAPABILITY.push,
  notifications: CAPABILITY.push,
  payments: CAPABILITY.payments,
  billing: CAPABILITY.payments,
};

/**
 * `faceVerification`, `Face-Verification`, `FACE VERIFICATION` → `face_verification`.
 * Serverul scrie snake_case, dar un `camelCase` scăpat într-un schema Pydantic
 * cu alias nu trebuie să ne lase cu funcția ascunsă din greșeală.
 */
export function normalizeKey(raw: string): string {
  return raw
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s.-]+/g, '_')
    .replace(/_+/g, '_')
    .toLowerCase();
}

/** Steagul dintr-o valoare brută, sau `null` dacă nu e unul recognoscibil. */
function toFlag(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const field of FLAG_FIELDS) {
      const flag = record[field];
      if (typeof flag === 'boolean') return flag;
    }
  }
  return null;
}

/** Adaugă o pereche în hartă, sub numele canonic ȘI sub cel brut normalizat. */
function put(into: Record<string, boolean>, rawKey: string, value: boolean): void {
  const key = normalizeKey(rawKey);
  if (!key) return;
  into[key] = value;
  const canonical = ALIASES[key];
  // Un sinonim NU are voie să stingă un nume canonic deja pus de server: dacă
  // răspunsul conține și `face_verification`, și `verification`, câștigă cel
  // canonic, oricare ar fi ordinea cheilor.
  if (canonical && canonical !== key && !(canonical in into)) into[canonical] = value;
}

/**
 * Răspunsul brut → harta normalizată.
 *
 * Orice nu se înțelege e IGNORAT, nu presupus adevărat: o cheie absentă din
 * hartă înseamnă „indisponibilă" (vezi `isCapabilityEnabled`). Asta e direcția
 * sigură — ascundem o funcție care poate merge, în loc să arătăm una care minte.
 */
export function normalizeCapabilities(raw: unknown): CapabilityMap {
  if (raw === null || typeof raw !== 'object') return NO_CAPABILITIES;

  let source: unknown = raw;
  if (!Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    for (const container of CONTAINER_KEYS) {
      const inner = record[container];
      if (inner !== null && typeof inner === 'object') {
        source = inner;
        break;
      }
    }
  }

  const out: Record<string, boolean> = {};

  // Forma „listă": doar funcțiile ACTIVE sunt enumerate, restul lipsesc.
  if (Array.isArray(source)) {
    for (const item of source) {
      if (typeof item === 'string') put(out, item, true);
      else if (item !== null && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        const name = record.name ?? record.key ?? record.id;
        if (typeof name === 'string') put(out, name, toFlag(item) ?? true);
      }
    }
    return Object.freeze(out);
  }

  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    const flag = toFlag(value);
    if (flag !== null) put(out, key, flag);
  }
  return Object.freeze(out);
}

/**
 * E funcția disponibilă?
 *
 * ABSENȚA ÎNSEAMNĂ NU. Harta necunoscută (ruta a picat, serverul e vechi și
 * răspunde 404, răspunsul e de neînțeles) → totul ascuns. Dintre cele două
 * greșeli posibile, asta e cea mică: o funcție bună ascunsă o zi se repară cu un
 * deploy, pe când o insignă de încredere falsă arătată o zi se plătește în
 * încrederea utilizatorilor în tot produsul.
 */
export function isCapabilityEnabled(map: CapabilityMap, name: string): boolean {
  return map[normalizeKey(name)] === true;
}

/** Citește capabilitățile de la server. Aruncă la eroare — decide apelantul. */
export async function fetchCapabilities(): Promise<CapabilityMap> {
  const { data } = await api.get<unknown>(CAPABILITIES_PATH);
  return normalizeCapabilities(data);
}
