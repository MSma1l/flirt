/**
 * Instrucțiunile de plată prin transfer bancar (`PaymentInstructions` din
 * `backend/app/schemas/ticket_order.py`), într-un modul separat ca să le poată
 * folosi și fluxul de bilete, și cel de cereri manuale fără import circular.
 */
export interface PaymentInstructions {
  beneficiary: string;
  iban: string;
  bankName: string | null;
  amount: number;
  currency: string;
  /** Referința userului (`U-XXXXXXXX`). */
  reference: string;
  /** Textul exact de scris la „destinația plății". */
  commentTemplate: string;
  instructions: string | null;
}

export function mapPayment(p: Record<string, unknown>): PaymentInstructions {
  const amount = typeof p.amount === 'number' && Number.isFinite(p.amount) ? p.amount : 0;
  const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
  return {
    beneficiary: String(p.beneficiary ?? ''),
    iban: String(p.iban ?? ''),
    bankName: text(p.bank_name),
    amount,
    currency: String(p.currency ?? 'lei'),
    reference: String(p.reference ?? ''),
    commentTemplate: String(p.comment_template ?? ''),
    instructions: text(p.instructions),
  };
}
