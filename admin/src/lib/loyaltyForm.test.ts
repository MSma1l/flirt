/**
 * Regulile de fidelitate, testate direct — fără React, fără DOM.
 *
 * Fiecare test numește regula de backend pe care o oglindește: dacă schema din
 * `backend/app/schemas/loyalty.py` se schimbă, testul ăsta trebuie să pice.
 */
import { describe, expect, it } from 'vitest';

import type { LoyaltyInvite, LoyaltyTiers } from '../api/types';
import {
  EMPTY_INVITE_FORM,
  INVITE_SERVER_DEFAULTS,
  TIER_LIMITS,
  hasTierErrors,
  inviteStatusTone,
  inviteWarnings,
  selectInvites,
  tierChanges,
  tiersToForm,
  tiersWarnings,
  toInvitePayload,
  toTiersPayload,
  usageLabel,
  validateInvite,
  validateTiers,
  type TierRow,
  type TiersFormState,
} from './loyaltyForm';

const DAY = 24 * 60 * 60 * 1000;

function row(overrides: Partial<TierRow> = {}): TierRow {
  return { code: 'bronze', name: 'Bronze', min_stamps: '3', discount_percent: '5', ...overrides };
}

function form(tiers: TierRow[], cap = '30'): TiersFormState {
  return { tiers, max_total_discount_percent: cap };
}

const LADDER = form([
  row(),
  row({ code: 'silver', name: 'Silver', min_stamps: '6', discount_percent: '10' }),
  row({ code: 'gold', name: 'Gold', min_stamps: '12', discount_percent: '15' }),
]);

describe('validateTiers — scara validă', () => {
  it('acceptă o scară crescătoare', () => {
    expect(hasTierErrors(validateTiers(LADDER))).toBe(false);
  });

  it('acceptă lista goală (program de fidelitate oprit)', () => {
    expect(hasTierErrors(validateTiers(form([])))).toBe(false);
  });
});

describe('validateTiers — ce ar strica backendul în tăcere', () => {
  it('respinge un prag mai mic decât cel precedent (backendul ar REORDONA scara)', () => {
    const errors = validateTiers(
      form([row(), row({ code: 'silver', name: 'Silver', min_stamps: '2' })]),
    );
    expect(hasTierErrors(errors)).toBe(true);
    expect(errors.rows[1]?.min_stamps).toMatch(/mai mare decât al treptei precedente/);
  });

  it('respinge două praguri egale', () => {
    const errors = validateTiers(
      form([row(), row({ code: 'silver', name: 'Silver', min_stamps: '3' })]),
    );
    expect(errors.rows[1]?.min_stamps).toMatch(/același prag/);
  });

  it('respinge codurile duplicate (backendul ar ȘTERGE treapta a doua)', () => {
    const errors = validateTiers(
      form([row(), row({ name: 'Silver', min_stamps: '6', discount_percent: '10' })]),
    );
    expect(errors.rows[1]?.code).toMatch(/se repetă/);
  });
});

describe('validateTiers — plafoanele de schemă', () => {
  it('cere cod și nume (safe_str NON-GOL)', () => {
    const errors = validateTiers(form([row({ code: '  ', name: '' })]));
    expect(errors.rows[0]?.code).toMatch(/obligatoriu/);
    expect(errors.rows[0]?.name).toMatch(/obligatoriu/);
  });

  it('respinge marcajele HTML din nume (validatorii defensivi din backend)', () => {
    const errors = validateTiers(form([row({ name: '<b>Bronze</b>' })]));
    expect(errors.rows[0]?.name).toMatch(/HTML/);
  });

  it('cere prag ÎNTREG ≥ 1 și ≤ STAMPS_MAX', () => {
    expect(validateTiers(form([row({ min_stamps: '0' })])).rows[0]?.min_stamps).toMatch(
      /Pragul minim este 1/,
    );
    expect(validateTiers(form([row({ min_stamps: '2.5' })])).rows[0]?.min_stamps).toMatch(
      /întreg/,
    );
    expect(
      validateTiers(form([row({ min_stamps: String(TIER_LIMITS.minStamps + 1) })])).rows[0]
        ?.min_stamps,
    ).toMatch(/maxim/);
  });

  it('cere procent ÎNTREG în 0..100', () => {
    expect(validateTiers(form([row({ discount_percent: '101' })])).rows[0]?.discount_percent)
      .toMatch(/între 0 și 100/);
    expect(validateTiers(form([row({ discount_percent: '-1' })])).rows[0]?.discount_percent)
      .toMatch(/între 0 și 100/);
    expect(validateTiers(form([row({ discount_percent: '7.5' })])).rows[0]?.discount_percent)
      .toMatch(/întregi/);
  });

  it('respinge plafonul în afara intervalului 0..100', () => {
    expect(validateTiers(form([row()], '101')).cap).toMatch(/între 0 și 100/);
    expect(validateTiers(form([row()], '')).cap).toMatch(/obligatoriu/);
  });

  it('respinge mai mult de TIERS_MAX trepte', () => {
    const many = Array.from({ length: TIER_LIMITS.count + 1 }, (_, index) =>
      row({ code: `t${index}`, name: `T${index}`, min_stamps: String(index + 1) }),
    );
    expect(validateTiers(form(many)).list).toMatch(/Maximum 10/);
  });
});

describe('tiersWarnings — ce acceptă backendul, dar înseamnă altceva', () => {
  it('avertizează când o treaptă depășește plafonul', () => {
    const warnings = tiersWarnings(form([row({ discount_percent: '40' })], '30'));
    expect(warnings.join(' ')).toMatch(/peste plafonul de 30%/);
  });

  it('avertizează când o treaptă superioară dă mai puțin decât una inferioară', () => {
    const warnings = tiersWarnings(
      form([row(), row({ code: 'silver', name: 'Silver', min_stamps: '6', discount_percent: '2' })]),
    );
    expect(warnings.join(' ')).toMatch(/MAI PUȚIN/);
  });

  it('spune explicit că lista goală oprește programul', () => {
    expect(tiersWarnings(form([])).join(' ')).toMatch(/programul de fidelitate se oprește/);
  });
});

describe('toTiersPayload', () => {
  it('trimite numere, nu text, și taie spațiile', () => {
    expect(toTiersPayload(form([row({ code: ' bronze ', min_stamps: ' 3 ' })], ' 30 '))).toEqual({
      tiers: [{ code: 'bronze', name: 'Bronze', min_stamps: 3, discount_percent: 5 }],
      max_total_discount_percent: 30,
    });
  });
});

describe('tierChanges — consecința, în cuvinte', () => {
  const saved: LoyaltyTiers = {
    tiers: [
      { code: 'bronze', name: 'Bronze', min_stamps: 3, discount_percent: 5 },
      { code: 'silver', name: 'Silver', min_stamps: 6, discount_percent: 10 },
    ],
    max_total_discount_percent: 30,
    updated_at: new Date().toISOString(),
  };

  it('spune cine PIERDE treapta când pragul urcă', () => {
    const next = tiersToForm(saved);
    next.tiers[0] = { ...next.tiers[0]!, min_stamps: '5' };
    expect(tierChanges(saved, next).join(' ')).toMatch(/PIERD treapta/);
    expect(tierChanges(saved, next).join(' ')).toContain('3–4');
  });

  it('spune cine PRIMEȘTE treapta când pragul coboară', () => {
    const next = tiersToForm(saved);
    next.tiers[1] = { ...next.tiers[1]!, min_stamps: '4' };
    expect(tierChanges(saved, next).join(' ')).toMatch(/PRIMESC treapta/);
  });

  it('anunță treapta nouă, treapta dispărută și plafonul schimbat', () => {
    const next: TiersFormState = {
      tiers: [
        { code: 'bronze', name: 'Bronze', min_stamps: '3', discount_percent: '5' },
        { code: 'platinum', name: 'Platinum', min_stamps: '20', discount_percent: '25' },
      ],
      max_total_discount_percent: '20',
    };
    const lines = tierChanges(saved, next).join(' ');
    expect(lines).toMatch(/Treaptă NOUĂ „Platinum"/);
    expect(lines).toMatch(/„Silver" DISPARE/);
    expect(lines).toMatch(/Plafonul total trece de la 30% la 20%/);
  });

  it('nu spune nimic când nu s-a schimbat nimic', () => {
    expect(tierChanges(saved, tiersToForm(saved))).toEqual([]);
  });
});

/* ------------------------------ invitații ------------------------------- */

/** `datetime-local` la `n` zile distanță de acum (negativ = în trecut). */
function localInDays(days: number): string {
  const date = new Date(Date.now() + days * DAY);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

const VALID_INVITE = {
  ...EMPTY_INVITE_FORM,
  event_id: 'e-1',
  max_uses: '5',
  expires_at: localInDays(7),
};

describe('validateInvite', () => {
  it('acceptă un formular complet', () => {
    expect(validateInvite({ ...VALID_INVITE, min_tier: 'silver', discount_percent: '20' })).toEqual(
      {},
    );
  });

  it('cere evenimentul', () => {
    expect(validateInvite({ ...VALID_INVITE, event_id: '' }).event_id).toMatch(/Alege evenimentul/);
  });

  it('cere cel puțin o folosire, întreagă (`Field(ge=1)`)', () => {
    expect(validateInvite({ ...VALID_INVITE, max_uses: '0' }).max_uses).toMatch(/cel puțin/);
    expect(validateInvite({ ...VALID_INVITE, max_uses: '2.5' }).max_uses).toMatch(/întreg/);
    expect(validateInvite({ ...VALID_INVITE, max_uses: '' }).max_uses).toMatch(/obligatoriu/);
  });

  it('respinge expirarea în trecut (400 pe backend)', () => {
    expect(validateInvite({ ...VALID_INVITE, expires_at: localInDays(-1) }).expires_at).toMatch(
      /în viitor/,
    );
    expect(validateInvite({ ...VALID_INVITE, expires_at: '' }).expires_at).toMatch(/obligatorie/);
  });

  it('respinge procentul în afara intervalului 0..100', () => {
    expect(validateInvite({ ...VALID_INVITE, discount_percent: '120' }).discount_percent).toMatch(
      /între 0 și 100/,
    );
  });

  it('respinge nota cu HTML sau prea lungă (optional_safe_str(500))', () => {
    expect(validateInvite({ ...VALID_INVITE, note: '<script>x</script>' }).note).toMatch(/HTML/);
    expect(validateInvite({ ...VALID_INVITE, note: 'x'.repeat(501) }).note).toMatch(/maximum 500/);
  });
});

describe('toInvitePayload', () => {
  it('trimite `null`, nu string gol, pentru câmpurile opționale', () => {
    const payload = toInvitePayload(VALID_INVITE);
    expect(payload.min_tier).toBeNull();
    expect(payload.note).toBeNull();
    expect(payload.discount_percent).toBeNull();
    expect(payload.max_uses).toBe(5);
    expect(payload.expires_at).toMatch(/Z$/);
  });

  it('păstrează treapta minimă, procentul și nota când sunt completate', () => {
    const payload = toInvitePayload({
      ...VALID_INVITE,
      min_tier: 'gold',
      discount_percent: '25',
      note: '  Pentru DJ  ',
    });
    expect(payload).toMatchObject({ min_tier: 'gold', discount_percent: 25, note: 'Pentru DJ' });
  });
});

describe('inviteWarnings', () => {
  it('avertizează peste plafoanele IMPLICITE de configurare ale serverului', () => {
    const many = { ...VALID_INVITE, max_uses: String(INVITE_SERVER_DEFAULTS.maxUsesCap + 1) };
    expect(validateInvite(many).max_uses).toBeUndefined(); // NEblocant: plafonul e configurabil
    expect(inviteWarnings(many).join(' ')).toMatch(/500 de folosiri/);

    const far = { ...VALID_INVITE, expires_at: localInDays(INVITE_SERVER_DEFAULTS.maxDays + 30) };
    expect(inviteWarnings(far).join(' ')).toMatch(/365 de zile/);
  });

  it('spune că o invitație fără procent nu schimbă prețul', () => {
    expect(inviteWarnings(VALID_INVITE).join(' ')).toMatch(/NU schimbă prețul/);
  });
});

/* -------------------------------- lista --------------------------------- */

function invite(overrides: Partial<LoyaltyInvite> = {}): LoyaltyInvite {
  return {
    id: 'i-1',
    event_id: 'e-1',
    event_title: 'Flirt Party',
    code: 'ABCD2345EFGH',
    max_uses: 5,
    used_count: 2,
    uses_left: 3,
    expires_at: new Date(Date.now() + 7 * DAY).toISOString(),
    min_tier: null,
    min_stamps_required: null,
    discount_percent: null,
    note: null,
    revoked_at: null,
    created_at: new Date().toISOString(),
    status: 'active',
    ...overrides,
  };
}

describe('selectInvites', () => {
  const items = [
    invite(),
    invite({ id: 'i-2', event_id: 'e-2', status: 'revoked' }),
    invite({ id: 'i-3', status: 'expired' }),
  ];

  it('filtrează după eveniment', () => {
    expect(selectInvites(items, { eventId: 'e-2' }).map((i) => i.id)).toEqual(['i-2']);
  });

  it('filtrează după stare', () => {
    expect(selectInvites(items, { status: 'expired' }).map((i) => i.id)).toEqual(['i-3']);
  });

  it('combină filtrele', () => {
    expect(selectInvites(items, { eventId: 'e-1', status: 'active' }).map((i) => i.id)).toEqual([
      'i-1',
    ]);
  });
});

describe('etichete de listă', () => {
  it('spune câte folosiri s-au consumat din câte', () => {
    expect(usageLabel(invite())).toBe('2 din 5 folosite');
  });

  it('dă fiecărei stări tonul ei', () => {
    expect(inviteStatusTone('active')).toBe('success');
    expect(inviteStatusTone('revoked')).toBe('danger');
    expect(inviteStatusTone('expired')).toBe('warning');
    expect(inviteStatusTone('exhausted')).toBe('neutral');
  });
});
