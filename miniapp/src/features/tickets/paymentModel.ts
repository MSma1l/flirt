/**
 * Instrucțiunile de plată (`PaymentInstructions` din
 * `backend/app/schemas/ticket_order.py`), într-un modul separat ca să le poată
 * folosi și fluxul de bilete, și cel de cereri manuale fără import circular.
 *
 * Două metode, în ordinea dată de server (`payment_methods`):
 *  - `mia`  — MIA Plăți Instant: plata din aplicația băncii după NUMĂR DE TELEFON;
 *  - `iban` — transferul bancar clasic.
 * Un server vechi nu trimite `payment_methods` → lista rămâne goală și ecranul
 * arată exact ca înainte (doar datele bancare).
 */
export type PaymentMethod = 'mia' | 'iban';

const KNOWN_METHODS: readonly PaymentMethod[] = ['mia', 'iban'];

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
  /** MIA: telefonul destinatarului (`+373XXXXXXXX`); null = MIA neconfigurat. */
  miaPhone?: string | null;
  /** MIA: numele pe care plătitorul îl vede confirmat în aplicația băncii. */
  miaRecipientName?: string | null;
  /** MIA: imaginea codului QR (URL public); null = fără QR. */
  miaQrUrl?: string | null;
  /** Metodele configurate, în ordinea de afișare; [] = server vechi. */
  methods?: PaymentMethod[];
}

/** Metodele valide din răspuns, fără duplicate, în ordinea serverului. */
export function parseMethods(value: unknown): PaymentMethod[] {
  if (!Array.isArray(value)) return [];
  const out: PaymentMethod[] = [];
  for (const item of value) {
    if ((KNOWN_METHODS as readonly unknown[]).includes(item) && !out.includes(item as PaymentMethod)) {
      out.push(item as PaymentMethod);
    }
  }
  return out;
}

export function mapPayment(p: Record<string, unknown>): PaymentInstructions {
  const amount = typeof p.amount === 'number' && Number.isFinite(p.amount) ? p.amount : 0;
  const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
  const miaPhone = text(p.mia_phone);
  // Doar URL-uri http(s) sau relative la server ajung într-un <img> (fără `data:`/`javascript:`).
  const rawQr = text(p.mia_qr_url);
  const miaQrUrl = rawQr && /^(https?:\/\/|\/)/.test(rawQr) ? rawQr : null;
  // Fără telefon și fără QR nu există plată MIA, orice ar spune lista.
  const methods = parseMethods(p.payment_methods).filter((m) => m !== 'mia' || miaPhone || miaQrUrl);
  return {
    beneficiary: String(p.beneficiary ?? ''),
    iban: String(p.iban ?? ''),
    bankName: text(p.bank_name),
    amount,
    currency: String(p.currency ?? 'lei'),
    reference: String(p.reference ?? ''),
    commentTemplate: String(p.comment_template ?? ''),
    instructions: text(p.instructions),
    miaPhone,
    miaRecipientName: text(p.mia_recipient_name),
    miaQrUrl,
    methods,
  };
}
