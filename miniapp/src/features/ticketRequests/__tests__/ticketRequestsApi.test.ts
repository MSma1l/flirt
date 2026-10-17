import { describe, expect, it } from 'vitest';

import { normalizePaymentProof, PAYMENT_PROOF_MAX_BYTES, validatePaymentProof } from '../ticketRequestsApi';

describe('validarea dovezii de plată', () => {
  it('acceptă o imagine JPEG în limita permisă', () => {
    expect(validatePaymentProof(new File(['ok'], 'bon.jpg', { type: 'image/jpeg' }))).toBeNull();
  });

  it('acceptă și chitanța PDF exportată din aplicația băncii', () => {
    expect(validatePaymentProof(new File(['%PDF-1.4'], 'chitanta.pdf', { type: 'application/pdf' }))).toBeNull();
  });

  it('respinge formatele neacceptate și fișierele prea mari înainte de upload', () => {
    expect(validatePaymentProof(new File(['x'], 'bon.txt', { type: 'text/plain' }))).toMatch(/JPG/);
    expect(validatePaymentProof(new File([new Uint8Array(PAYMENT_PROOF_MAX_BYTES + 1)], 'bon.png', { type: 'image/png' }))).toMatch(/8 MB/);
  });

  it('respinge un fișier gol (serverul l-ar refuza oricum)', () => {
    expect(validatePaymentProof(new File([], 'bon.png', { type: 'image/png' }))).toMatch(/gol/);
  });
});

describe('tipul chitanței când telefonul nu-l spune', () => {
  it('deduce tipul din extensie pentru un fișier fără tip', () => {
    const raw = new File(['%PDF-1.4'], 'Chitanta.PDF', { type: '' });
    const fixed = normalizePaymentProof(raw);
    expect(fixed.type).toBe('application/pdf');
    expect(fixed.name).toBe('Chitanta.PDF');
    expect(fixed.size).toBe(raw.size);
    expect(validatePaymentProof(fixed)).toBeNull();
  });

  it('traduce aliasurile Android (`image/jpg`) în tipul standard', () => {
    expect(normalizePaymentProof(new File(['x'], 'bon', { type: 'image/jpg' })).type).toBe('image/jpeg');
  });

  it('nu inventează un tip pentru formate necunoscute', () => {
    const heic = new File(['x'], 'IMG_1.heic', { type: 'image/heic' });
    expect(normalizePaymentProof(heic)).toBe(heic);
    expect(validatePaymentProof(normalizePaymentProof(new File(['x'], 'nota.txt', { type: '' })))).toMatch(/JPG/);
  });
});
