import { describe, expect, it } from 'vitest';

import { PAYMENT_PROOF_MAX_BYTES, validatePaymentProof } from '../ticketRequestsApi';

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
});
