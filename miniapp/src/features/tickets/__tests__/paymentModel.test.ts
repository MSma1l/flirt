/**
 * Maparea instrucțiunilor de plată: metodele MIA / IBAN, compatibilitatea cu un
 * server vechi (fără `payment_methods`) și filtrul URL-ului QR.
 */
import { describe, expect, it } from 'vitest';

import { mapPayment, parseMethods } from '../paymentModel';

const BASE = {
  beneficiary: 'SRL Flirt',
  iban: 'MD24AG000000022512345678',
  bank_name: 'maib',
  amount: 200,
  currency: 'lei',
  reference: 'U-1A2B3C4D',
  comment_template: 'Bilet Ref:U-1A2B3C4D',
  instructions: null,
};

describe('mapPayment', () => {
  it('un server vechi (fără câmpurile MIA) dă lista de metode goală', () => {
    const p = mapPayment(BASE);
    expect(p.methods).toEqual([]);
    expect(p.miaPhone).toBeNull();
    expect(p.miaQrUrl).toBeNull();
    expect(p.iban).toBe(BASE.iban);
  });

  it('păstrează ordinea serverului și datele MIA', () => {
    const p = mapPayment({
      ...BASE,
      mia_phone: '+37369123456',
      mia_recipient_name: 'Ion Popescu',
      mia_qr_url: 'https://media.flrt.md/photos/payment-qr/a.png',
      payment_methods: ['mia', 'iban'],
    });
    expect(p.methods).toEqual(['mia', 'iban']);
    expect(p.miaPhone).toBe('+37369123456');
    expect(p.miaRecipientName).toBe('Ion Popescu');
    expect(p.miaQrUrl).toContain('payment-qr');
  });

  it('MIA doar cu QR (fără telefon) rămâne o metodă validă', () => {
    const p = mapPayment({ ...BASE, mia_qr_url: '/media/photos/payment-qr/a.png', payment_methods: ['mia'] });
    expect(p.methods).toEqual(['mia']);
  });

  it('fără telefon și fără QR, „mia" din listă e ignorat; URL-urile periculoase nu trec', () => {
    const p = mapPayment({ ...BASE, mia_qr_url: 'javascript:alert(1)', payment_methods: ['mia', 'iban'] });
    expect(p.miaQrUrl).toBeNull();
    expect(p.methods).toEqual(['iban']);
  });
});

describe('parseMethods', () => {
  it('ignoră valorile necunoscute și duplicatele', () => {
    expect(parseMethods(['iban', 'card', 'iban', 'mia'])).toEqual(['iban', 'mia']);
    expect(parseMethods('mia')).toEqual([]);
  });
});
