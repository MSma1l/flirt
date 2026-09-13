/**
 * Prețul biletului AȘA CUM ÎL PLĂTEȘTE UTILIZATORUL ĂSTA, cu motivul reducerii.
 *
 * Toate cifrele vin din `GET /loyalty/events/{id}/ticket-quote`. Componenta nu
 * înmulțește și nu scade nimic: dacă ar recalcula procentul, ar deveni a doua
 * sursă de adevăr față de prețul înscris pe comandă de
 * `ticket_order_service.create_order`, iar cele două s-ar despărți la prima
 * schimbare de regulă pe server. Aici doar SE AFIȘEAZĂ.
 *
 * PREȚUL ÎNTREG SE VEDE TĂIAT. O reducere pe care omul n-o poate compara cu
 * nimic nu are efect: 200 de lei arată exact ca 200 de lei, până pui 250 tăiat
 * lângă. De aceea blocul apare DOAR când există efectiv o reducere — altfel ar
 * fi un preț repetat de două ori, o dată aici și o dată pe buton.
 */
import { useTranslation } from 'react-i18next';

import type { TicketQuote } from './loyaltyApi';
import { formatPrice } from './priceFormat';

import './loyalty.css';

/** Cheia motivului, după sursa aleasă de server. */
function reasonKey(quote: TicketQuote): string {
  switch (quote.appliedSource) {
    case 'loyalty':
      return quote.tier ? 'loyalty.price.reason.loyaltyTier' : 'loyalty.price.reason.loyalty';
    case 'promo':
      return 'loyalty.price.reason.promo';
    case 'invite':
      return 'loyalty.price.reason.invite';
    default:
      return 'loyalty.price.reason.other';
  }
}

export function TicketPriceBlock({ quote }: { quote: TicketQuote }) {
  const { t } = useTranslation('screens');

  // Fără reducere nu avem ce compara: prețul de pe buton e tot adevărul.
  if (quote.appliedPercent <= 0) return null;

  const finalText = formatPrice(quote.finalPrice, quote.currency);
  const baseText = formatPrice(quote.basePrice, quote.currency);

  return (
    <div
      className="ly-price"
      data-testid="ticket-quote"
      role="group"
      aria-label={t('loyalty.price.a11y', {
        price: finalText,
        base: baseText,
        percent: quote.appliedPercent,
      })}
    >
      <div className="ly-price__row">
        <span className="ly-price__final" data-testid="ticket-quote-final">
          {finalText}
        </span>
        <s className="ly-price__base" data-testid="ticket-quote-base">
          {baseText}
        </s>
        <span className="ly-price__badge">
          {t('loyalty.price.off', { percent: quote.appliedPercent })}
        </span>
      </div>

      <p className="ly-price__reason" data-testid="ticket-quote-reason">
        {t(reasonKey(quote), {
          percent: quote.appliedPercent,
          tier: quote.tier?.name ?? '',
        })}
      </p>

      {/* Plafonul e o informație onestă, nu o scuză: omul are dreptul să știe
          de ce reducerea lui nu e suma tuturor reducerilor pe care le vede. */}
      {quote.capped ? (
        <p className="caption ly-price__capped" data-testid="ticket-quote-capped">
          {t('loyalty.price.capped', { percent: quote.appliedPercent })}
        </p>
      ) : null}
    </div>
  );
}

export default TicketPriceBlock;
