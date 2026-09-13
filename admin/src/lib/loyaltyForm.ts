/**
 * Regulile de FIDELITATE ale panoului, ca funcții PURE (fără React).
 *
 * Ca și `lib/eventForm.ts`, fișierul ăsta e OGLINDA contractului de backend, ca
 * regula să fie citibilă lângă sursa ei și testabilă direct, nu îngropată în JSX.
 *
 * Ce copiem, linie cu linie, din `backend/app/schemas/loyalty.py`:
 *   * `TierIn.code`             → `safe_str(32)`  — trim, NON-GOL, fără HTML;
 *   * `TierIn.name`             → `safe_str(64)`;
 *   * `TierIn.min_stamps`       → `Field(ge=1, le=10_000)`, ÎNTREG;
 *   * `TierIn.discount_percent` → `Field(ge=0, le=100)`, ÎNTREG;
 *   * `TiersIn.tiers`           → `max_length=10` (TIERS_MAX);
 *   * `TiersIn.max_total_discount_percent` → `Field(ge=0, le=100)`;
 *   * `InviteIn.max_uses`       → `Field(ge=1)`;
 *   * `InviteIn.discount_percent` → `Field(ge=0, le=100) | None`;
 *   * `InviteIn.note`           → `optional_safe_str(500)`.
 *
 * ȘI DOUĂ REGULI CARE NU SUNT ÎN SCHEMĂ, DAR SUNT ÎN SERVICIU
 * -----------------------------------------------------------
 * 1. `services/loyalty._normalize_tiers` SORTEAZĂ scara după `min_stamps` și
 *    ELIMINĂ TĂCUT treptele cu cod duplicat. Backendul răspunde 200 — dar cu
 *    altă scară decât cea trimisă. De aceea panoul respinge AICI pragurile
 *    neordonate și codurile duplicate: un 200 care șterge o treaptă e mai
 *    periculos decât un 422.
 * 2. `services/loyalty.create_invite` respinge cu 400 expirarea în trecut. E
 *    singura verificare de dată pe care panoul o poate reproduce exact;
 *    plafoanele de CONFIGURARE (`loyalty_invite_max_uses_cap`,
 *    `loyalty_invite_max_days`) NU sunt expuse de nicio rută, deci aici sunt
 *    doar AVERTISMENTE cu valorile implicite, iar arbitrul rămâne serverul.
 */
import type {
  InviteInput,
  InviteStatus,
  LoyaltyInvite,
  LoyaltyTier,
  LoyaltyTiers,
  LoyaltyTiersInput,
} from '../api/types';
import { textProblem } from './eventForm';
import { fromDateTimeLocalValue } from './format';

/** Plafoanele de SCHEMĂ (`schemas/loyalty.py`) — aceleași nume, aceleași valori. */
export const TIER_LIMITS = {
  /** `TIERS_MAX` */
  count: 10,
  /** `TIER_CODE_MAX_LENGTH` */
  code: 32,
  /** `TIER_NAME_MAX_LENGTH` */
  name: 64,
  /** `STAMPS_MAX` */
  minStamps: 10_000,
} as const;

/** `NOTE_MAX_LENGTH` din schema invitației. */
export const INVITE_NOTE_MAX = 500;

/**
 * Plafoanele de CONFIGURARE ale serverului (`core/config.py`), cu valorile lor
 * IMPLICITE. Nu sunt expuse de nicio rută de admin, deci panoul nu are voie să
 * blocheze pe baza lor — le folosește doar ca să avertizeze din timp.
 */
export const INVITE_SERVER_DEFAULTS = {
  /** `loyalty_invite_max_uses_cap` */
  maxUsesCap: 500,
  /** `loyalty_invite_max_days` */
  maxDays: 365,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Întregul dintr-un câmp text: gol → `null`, orice altceva invalid → `NaN`. */
export function parseIntegerField(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (!/^[+-]?\d+$/.test(trimmed)) return Number.NaN;
  return Number(trimmed);
}

/* ========================================================================== */
/*  TREPTE                                                                     */
/* ========================================================================== */

/** O treaptă în formular — toate câmpurile ca text, ca în orice `<input>`. */
export interface TierRow {
  code: string;
  name: string;
  min_stamps: string;
  discount_percent: string;
}

export interface TiersFormState {
  tiers: TierRow[];
  max_total_discount_percent: string;
}

export const EMPTY_TIER_ROW: TierRow = {
  code: '',
  name: '',
  min_stamps: '',
  discount_percent: '',
};

export function tiersToForm(data: LoyaltyTiers): TiersFormState {
  return {
    tiers: data.tiers.map((tier) => ({
      code: tier.code,
      name: tier.name,
      min_stamps: String(tier.min_stamps),
      discount_percent: String(tier.discount_percent),
    })),
    max_total_discount_percent: String(data.max_total_discount_percent),
  };
}

export type TierRowErrors = Partial<Record<keyof TierRow, string>>;

export interface TiersErrors {
  /** Erorile fiecărei trepte, pe aceeași poziție ca în formular. */
  rows: TierRowErrors[];
  /** Eroarea plafonului total. */
  cap?: string;
  /** Eroare la nivel de listă (ex. prea multe trepte). */
  list?: string;
}

/**
 * Erorile BLOCANTE ale scării de trepte: exact ce ar respinge backendul cu 422
 * — PLUS cele două cazuri în care ar răspunde 200 cu altă scară decât cea
 * trimisă (praguri neordonate, coduri duplicate).
 */
export function validateTiers(form: TiersFormState): TiersErrors {
  const rows: TierRowErrors[] = [];
  const seen = new Map<string, number>();
  let previous: { stamps: number; label: string } | null = null;

  form.tiers.forEach((tier, index) => {
    const errors: TierRowErrors = {};
    const code = tier.code.trim();
    const label = tier.name.trim() || code || `treapta ${index + 1}`;

    // --- cod (safe_str, NON-GOL) + unicitate (`_normalize_tiers` taie duplicatele)
    if (code === '') {
      errors.code = 'Codul treptei este obligatoriu.';
    } else {
      const problem = textProblem(code, TIER_LIMITS.code, 'Cod');
      if (problem) {
        errors.code = problem;
      } else if (seen.has(code)) {
        const first = (seen.get(code) ?? 0) + 1;
        errors.code =
          `Codul „${code}" se repetă (treapta ${first}). Backendul ar păstra doar prima ` +
          'treaptă cu acest cod și ar șterge-o tăcut pe a doua.';
      } else {
        seen.set(code, index);
      }
    }

    // --- nume (safe_str, NON-GOL) ---
    if (tier.name.trim() === '') {
      errors.name = 'Numele treptei este obligatoriu.';
    } else {
      const problem = textProblem(tier.name, TIER_LIMITS.name, 'Nume');
      if (problem) errors.name = problem;
    }

    // --- prag (ge=1, le=10_000, întreg) + ORDINE strict crescătoare ---
    const stamps = parseIntegerField(tier.min_stamps);
    if (stamps === null) {
      errors.min_stamps = 'Pragul este obligatoriu.';
    } else if (Number.isNaN(stamps)) {
      errors.min_stamps = 'Pragul se scrie ca număr întreg de ștampile.';
    } else if (stamps < 1) {
      errors.min_stamps = 'Pragul minim este 1 ștampilă.';
    } else if (stamps > TIER_LIMITS.minStamps) {
      errors.min_stamps = `Pragul maxim este ${TIER_LIMITS.minStamps} de ștampile.`;
    } else if (previous !== null && stamps === previous.stamps) {
      errors.min_stamps =
        `Două trepte nu pot începe de la același prag: „${previous.label}" începe tot ` +
        `de la ${stamps}.`;
    } else if (previous !== null && stamps < previous.stamps) {
      errors.min_stamps =
        `Pragul trebuie să fie mai mare decât al treptei precedente („${previous.label}" ` +
        `= ${previous.stamps}). Backendul ar reordona scara în tăcere.`;
    }
    if (errors.min_stamps === undefined && stamps !== null && !Number.isNaN(stamps)) {
      previous = { stamps, label };
    }

    // --- procent (ge=0, le=100, întreg) ---
    const percent = parseIntegerField(tier.discount_percent);
    if (percent === null) {
      errors.discount_percent = 'Procentul este obligatoriu (poate fi 0).';
    } else if (Number.isNaN(percent) || !Number.isInteger(percent)) {
      errors.discount_percent = 'Reducerea se exprimă în procente întregi.';
    } else if (percent < 0 || percent > 100) {
      errors.discount_percent = 'Reducerea trebuie să fie între 0 și 100%.';
    }

    rows.push(errors);
  });

  const result: TiersErrors = { rows };

  if (form.tiers.length > TIER_LIMITS.count) {
    result.list = `Maximum ${TIER_LIMITS.count} de trepte (plafonul schemei de pe backend).`;
  }

  const cap = parseIntegerField(form.max_total_discount_percent);
  if (cap === null) {
    result.cap = 'Plafonul este obligatoriu (0 = nicio reducere).';
  } else if (Number.isNaN(cap) || !Number.isInteger(cap)) {
    result.cap = 'Plafonul se exprimă în procente întregi.';
  } else if (cap < 0 || cap > 100) {
    result.cap = 'Plafonul trebuie să fie între 0 și 100%.';
  }

  return result;
}

export function hasTierErrors(errors: TiersErrors): boolean {
  if (errors.cap !== undefined || errors.list !== undefined) return true;
  return errors.rows.some((row) => Object.keys(row).length > 0);
}

/**
 * Avertismente NEBLOCANTE: configurări pe care backendul le acceptă, dar care
 * înseamnă altceva decât pare. Nu se blochează, tocmai ca panoul să rămână
 * oglinda backendului, nu o a doua autoritate.
 */
export function tiersWarnings(form: TiersFormState): string[] {
  const list: string[] = [];
  const cap = parseIntegerField(form.max_total_discount_percent);
  const capValid = cap !== null && !Number.isNaN(cap);

  if (form.tiers.length === 0) {
    list.push(
      'Scara este GOALĂ: programul de fidelitate se oprește — niciun utilizator nu mai ' +
        'primește reducere de treaptă (promo-urile evenimentelor rămân neatinse).',
    );
  }
  if (capValid && cap === 0 && form.tiers.length > 0) {
    list.push(
      'Plafonul de 0% anulează ORICE reducere la bilet, oricât ar da treptele sau promo-ul.',
    );
  }

  let best: { label: string; percent: number } | null = null;
  for (const tier of form.tiers) {
    const percent = parseIntegerField(tier.discount_percent);
    if (percent === null || Number.isNaN(percent)) continue;
    const label = tier.name.trim() || tier.code.trim() || 'treaptă';

    if (capValid && cap > 0 && percent > cap) {
      list.push(
        `Treapta „${label}" dă ${percent}%, peste plafonul de ${cap}% — la bilet se aplică ` +
          `tot ${cap}%.`,
      );
    }
    if (best !== null && percent < best.percent) {
      list.push(
        `Treapta „${label}" (${percent}%) dă MAI PUȚIN decât „${best.label}" ` +
          `(${best.percent}%), deși cere mai multe ștampile.`,
      );
    }
    if (best === null || percent > best.percent) best = { label, percent };
  }
  return list;
}

/** Formularul → payload-ul exact cerut de `TiersIn`. */
export function toTiersPayload(form: TiersFormState): LoyaltyTiersInput {
  return {
    tiers: form.tiers.map((tier) => ({
      code: tier.code.trim(),
      name: tier.name.trim(),
      min_stamps: Number(tier.min_stamps.trim()),
      discount_percent: Number(tier.discount_percent.trim()),
    })),
    max_total_discount_percent: Number(form.max_total_discount_percent.trim()),
  };
}

/** „3–4" sau „3", pentru intervalul de ștampile prins între două praguri. */
function stampRange(from: number, to: number): string {
  const low = Math.min(from, to);
  const high = Math.max(from, to) - 1;
  return low >= high ? String(low) : `${low}–${high}`;
}

/**
 * CONSECINȚA unei modificări, în cuvinte.
 *
 * ATENȚIE, LIMITARE REALĂ: backendul NU expune nicăieri distribuția ștampilelor
 * (nu există nici în `/admin/stats`, nici în `/admin/users`), deci panoul nu
 * poate spune CÂȚI utilizatori sunt afectați fără să inventeze o cifră. Spune,
 * în schimb, exact PE CINE atinge schimbarea — intervalul de ștampile care
 * câștigă sau pierde treapta — ceea ce se poate deduce corect din datele avute.
 */
export function tierChanges(saved: LoyaltyTiers | undefined, form: TiersFormState): string[] {
  if (!saved) return [];
  const next = toTiersPayload(form);
  const lines: string[] = [];

  const savedByCode = new Map<string, LoyaltyTier>(saved.tiers.map((t) => [t.code, t]));
  const nextByCode = new Map<string, LoyaltyTier>(next.tiers.map((t) => [t.code, t]));

  for (const tier of next.tiers) {
    if (!Number.isFinite(tier.min_stamps) || !Number.isFinite(tier.discount_percent)) continue;
    const before = savedByCode.get(tier.code);
    const label = tier.name || tier.code;
    if (!before) {
      lines.push(
        `Treaptă NOUĂ „${label}": de la ${tier.min_stamps} ștampile, −${tier.discount_percent}%.`,
      );
      continue;
    }
    if (before.min_stamps !== tier.min_stamps) {
      const range = stampRange(before.min_stamps, tier.min_stamps);
      lines.push(
        tier.min_stamps > before.min_stamps
          ? `„${label}": pragul URCĂ de la ${before.min_stamps} la ${tier.min_stamps} ștampile — ` +
            `utilizatorii cu ${range} ștampile PIERD treapta și reducerea ei.`
          : `„${label}": pragul COBOARĂ de la ${before.min_stamps} la ${tier.min_stamps} ștampile — ` +
            `utilizatorii cu ${range} ștampile PRIMESC treapta de acum.`,
      );
    }
    if (before.discount_percent !== tier.discount_percent) {
      lines.push(
        `„${label}": reducerea trece de la ${before.discount_percent}% la ` +
          `${tier.discount_percent}% pentru toți cei care au treapta.`,
      );
    }
  }

  for (const tier of saved.tiers) {
    if (!nextByCode.has(tier.code)) {
      lines.push(
        `Treapta „${tier.name}" DISPARE (era de la ${tier.min_stamps} ștampile, ` +
          `−${tier.discount_percent}%): cine o avea rămâne fără reducerea ei.`,
      );
    }
  }

  const cap = next.max_total_discount_percent;
  if (Number.isFinite(cap) && cap !== saved.max_total_discount_percent) {
    lines.push(
      `Plafonul total trece de la ${saved.max_total_discount_percent}% la ${cap}%: orice ` +
        `reducere mai mare (treaptă, promo sau invitație) se taie la ${cap}%.`,
    );
  }
  return lines;
}

/* ========================================================================== */
/*  INVITAȚII                                                                  */
/* ========================================================================== */

export interface InviteFormState {
  event_id: string;
  max_uses: string;
  /** Valoare `datetime-local` (ora LOCALĂ a adminului). */
  expires_at: string;
  /** Codul treptei minime; `''` = fără cerință. */
  min_tier: string;
  discount_percent: string;
  note: string;
}

export const EMPTY_INVITE_FORM: InviteFormState = {
  event_id: '',
  max_uses: '1',
  expires_at: '',
  min_tier: '',
  discount_percent: '',
  note: '',
};

export type InviteFormErrors = Partial<Record<keyof InviteFormState, string>>;

/** Erorile BLOCANTE ale emiterii: 422 de schemă + 400-urile din `create_invite`. */
export function validateInvite(
  form: InviteFormState,
  now: number = Date.now(),
): InviteFormErrors {
  const errors: InviteFormErrors = {};

  if (form.event_id.trim() === '') {
    errors.event_id = 'Alege evenimentul pentru care se emite invitația.';
  }

  const uses = parseIntegerField(form.max_uses);
  if (uses === null) {
    errors.max_uses = 'Numărul de folosiri este obligatoriu.';
  } else if (Number.isNaN(uses) || !Number.isInteger(uses)) {
    errors.max_uses = 'Numărul de folosiri se scrie ca întreg.';
  } else if (uses < 1) {
    errors.max_uses = 'O invitație are cel puțin o folosire.';
  }

  if (form.expires_at.trim() === '') {
    errors.expires_at = 'Data de expirare este obligatorie.';
  } else {
    const iso = fromDateTimeLocalValue(form.expires_at);
    if (iso === '') {
      errors.expires_at = 'Data introdusă nu este validă.';
    } else if (new Date(iso).getTime() <= now) {
      errors.expires_at = 'Data de expirare trebuie să fie în viitor.';
    }
  }

  const percent = parseIntegerField(form.discount_percent);
  if (percent !== null) {
    if (Number.isNaN(percent) || !Number.isInteger(percent)) {
      errors.discount_percent = 'Reducerea se exprimă în procente întregi.';
    } else if (percent < 0 || percent > 100) {
      errors.discount_percent = 'Reducerea trebuie să fie între 0 și 100%.';
    }
  }

  const noteProblem = textProblem(form.note, INVITE_NOTE_MAX, 'Notă');
  if (noteProblem) errors.note = noteProblem;

  return errors;
}

/** Avertismente neblocante — inclusiv plafoanele de configurare, decise de server. */
export function inviteWarnings(
  form: InviteFormState,
  now: number = Date.now(),
): string[] {
  const list: string[] = [];

  const uses = parseIntegerField(form.max_uses);
  if (uses !== null && !Number.isNaN(uses) && uses > INVITE_SERVER_DEFAULTS.maxUsesCap) {
    list.push(
      `Plafonul implicit al serverului e ${INVITE_SERVER_DEFAULTS.maxUsesCap} de folosiri. ` +
        'Dacă nu a fost ridicat din configurare, serverul va respinge cererea.',
    );
  }

  const iso = fromDateTimeLocalValue(form.expires_at);
  if (iso !== '') {
    const delta = new Date(iso).getTime() - now;
    if (delta > INVITE_SERVER_DEFAULTS.maxDays * DAY_MS) {
      list.push(
        `Expirarea depășește ${INVITE_SERVER_DEFAULTS.maxDays} de zile — limita implicită a ` +
          'serverului. Dacă nu a fost ridicată din configurare, cererea va fi respinsă.',
      );
    } else if (delta > 0 && delta < DAY_MS) {
      list.push('Invitația expiră în mai puțin de 24 de ore — ajunge codul la invitat până atunci?');
    }
  }

  if (parseIntegerField(form.discount_percent) === null) {
    list.push(
      'Fără procent, invitația NU schimbă prețul biletului: dă doar dreptul de acces ' +
        '(și trece de cerința de treaptă, dacă ai pus una).',
    );
  }
  return list;
}

/** Formularul → payload-ul exact cerut de `InviteIn`. */
export function toInvitePayload(form: InviteFormState): InviteInput {
  const percent = parseIntegerField(form.discount_percent);
  const note = form.note.trim();
  const minTier = form.min_tier.trim();
  return {
    event_id: form.event_id,
    max_uses: Number(form.max_uses.trim()),
    expires_at: fromDateTimeLocalValue(form.expires_at),
    // Gol → `null`, NU string gol: `optional_safe_str` ar respinge `""` cu 422.
    min_tier: minTier === '' ? null : minTier,
    discount_percent: percent === null || Number.isNaN(percent) ? null : percent,
    note: note === '' ? null : note,
  };
}

/* ------------------------------ lista ----------------------------------- */

export type InviteStatusFilter = 'all' | InviteStatus;

export const INVITE_STATUS_LABELS: Record<InviteStatus, string> = {
  active: 'Activă',
  exhausted: 'Epuizată',
  expired: 'Expirată',
  revoked: 'Revocată',
};

export type StatusTone = 'success' | 'neutral' | 'warning' | 'danger';

export function inviteStatusTone(status: InviteStatus): StatusTone {
  if (status === 'active') return 'success';
  if (status === 'revoked') return 'danger';
  if (status === 'expired') return 'warning';
  return 'neutral';
}

/** „2 din 5 folosite" — cifra pe care adminul o caută prima. */
export function usageLabel(invite: LoyaltyInvite): string {
  return `${invite.used_count} din ${invite.max_uses} folosite`;
}

/**
 * Filtrarea listei.
 *
 * Filtrul pe eveniment se face și pe SERVER (`?event_id=`); aici e păstrat
 * pentru cazul în care lista vine deja încărcată (și pentru teste directe).
 */
export function selectInvites(
  invites: LoyaltyInvite[],
  options: { eventId?: string; status?: InviteStatusFilter } = {},
): LoyaltyInvite[] {
  const { eventId = 'all', status = 'all' } = options;
  return invites.filter((invite) => {
    if (eventId !== 'all' && invite.event_id !== eventId) return false;
    if (status !== 'all' && invite.status !== status) return false;
    return true;
  });
}
