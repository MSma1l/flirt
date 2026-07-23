/** Tipuri pentru cumpărarea de bilete online la eveniment prin transfer bancar. Toate câmpurile în camelCase. */

/** Statusurile posibile ale unei comenzi de bilet. */
export type TicketOrderStatus =
  | 'awaiting_payment'
  | 'payment_declared'
  | 'approved'
  | 'rejected';

/** O comandă de bilet a utilizatorului curent. */
export interface TicketOrder {
  id: string;
  /** Evenimentul pentru care s-a făcut comanda (pentru potrivire pe ecranul evenimentului). */
  eventId: string | null;
  status: TicketOrderStatus;
  /** Prețul biletului. `null` dacă backendul nu îl trimite. */
  price: number | null;
  /** Moneda (ex. „lei"). `null` dacă backendul nu o trimite. */
  currency: string | null;
  /** Codul biletului — prezent doar când comanda e `approved`. */
  ticketCode: string | null;
}

/** Instrucțiunile de plată prin transfer bancar, primite la crearea comenzii. */
export interface PaymentInstructions {
  /** Beneficiarul transferului. */
  beneficiary: string;
  iban: string;
  bankName: string;
  /** Suma de transferat. */
  amount: number;
  currency: string;
  /** Referința (codul de cont al userului) de pus în transfer. */
  reference: string;
  /** Comentariul structurat de scris exact la transfer. */
  commentTemplate: string;
  /** Instrucțiuni suplimentare, text liber de la backend (opțional). */
  instructions: string | null;
}

/** O comandă împreună cu instrucțiunile de plată (prezente cât timp e `awaiting_payment`). */
export interface TicketOrderDetail {
  order: TicketOrder;
  payment: PaymentInstructions | null;
}
