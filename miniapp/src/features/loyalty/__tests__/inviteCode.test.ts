/**
 * Normalizarea codului de invitație.
 *
 * DE CE are test propriu, deși e o funcție de patru rânduri: e OGLINDA lui
 * `normalize_code` din `backend/app/services/loyalty.py`. Dacă cele două se
 * despart, utilizatorul primește „cod inexistent" pentru un cod perfect valid —
 * cea mai derutantă eroare posibilă, și cea mai greu de reprodus.
 */
import { describe, expect, it } from 'vitest';

import { INVITE_CODE_MAX_LENGTH, normalizeInviteCode } from '../inviteCode';

describe('normalizeInviteCode', () => {
  it('ridică la majuscule', () => {
    expect(normalizeInviteCode('abcd2345')).toBe('ABCD2345');
  });

  it('aruncă spațiile de la capete și din interior', () => {
    expect(normalizeInviteCode('  ABCD 2345  ')).toBe('ABCD2345');
  });

  it('aruncă cratimele și underscore-urile cu care se dictează codul', () => {
    expect(normalizeInviteCode('abcd-2345')).toBe('ABCD2345');
    expect(normalizeInviteCode('ABCD_2345')).toBe('ABCD2345');
  });

  it('curăță un cod dictat la telefon, cu de toate', () => {
    expect(normalizeInviteCode(' abcd-efgh ijkl \n')).toBe('ABCDEFGHIJKL');
  });

  it('scoate și spațiile invizibile lipite din clipboard', () => {
    // `\r`, spațiul insecabil și tabul nu sunt toate în lista serverului, dar
    // sunt tot spațiu alb: un cod cu ele ar fi respins ca inexistent.
    expect(normalizeInviteCode('AB CD\r\t2345')).toBe('ABCD2345');
  });

  it('un câmp gol sau numai din spații rămâne gol', () => {
    expect(normalizeInviteCode('')).toBe('');
    expect(normalizeInviteCode('   \n\t ')).toBe('');
  });

  it('taie la plafonul serverului, ca cererea să nu fie respinsă de validator', () => {
    const long = 'A'.repeat(INVITE_CODE_MAX_LENGTH + 20);
    expect(normalizeInviteCode(long)).toHaveLength(INVITE_CODE_MAX_LENGTH);
  });

  it('e idempotentă: forma canonică rămâne neatinsă', () => {
    const once = normalizeInviteCode(' abc-d23 ');
    expect(normalizeInviteCode(once)).toBe(once);
  });
});
