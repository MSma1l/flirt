/**
 * Alegerea tipului de bilet: carduri selectabile (nume, descriere, preț,
 * „Epuizat"). Semantic e un grup de butoane radio — tastatura și cititoarele de
 * ecran îl înțeleg ca o singură alegere. Se afișează DOAR când există mai multe
 * tipuri (vezi `needsTierChoice`); cu unul singur fluxul rămâne fără pas în plus.
 */
import { useTranslation } from 'react-i18next';

import { formatPrice } from '@/features/loyalty/priceFormat';

import type { TicketTier } from './ticketTiers';

import './ticketTiers.css';

interface Props {
  tiers: readonly TicketTier[];
  selectedId: string | null;
  currency: string;
  onSelect: (id: string) => void;
}

export function TicketTierPicker({ tiers, selectedId, currency, onSelect }: Props) {
  const { t } = useTranslation('screens');
  return (
    <fieldset className="tt-picker" data-testid="ticket-tier-picker">
      <legend className="tt-picker__title">{t('ticketTiers.title')}</legend>
      {tiers.map((tier) => {
        const selected = tier.id === selectedId;
        return (
          <label
            key={tier.id}
            className={[
              'tt-card',
              selected ? 'tt-card--selected' : '',
              tier.soldOut ? 'tt-card--sold-out' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            data-testid={`ticket-tier-${tier.id}`}
          >
            <input
              type="radio"
              className="tt-card__radio"
              name="ticket-tier"
              value={tier.id}
              checked={selected}
              disabled={tier.soldOut}
              onChange={() => onSelect(tier.id)}
            />
            <span className="tt-card__check" aria-hidden="true" />
            <span className="tt-card__body">
              <span className="tt-card__name">{tier.name}</span>
              {tier.description ? <span className="tt-card__desc">{tier.description}</span> : null}
            </span>
            <span className="tt-card__side">
              {tier.soldOut ? (
                <span className="tt-card__sold-out">{t('ticketTiers.soldOut')}</span>
              ) : (
                <span className="tt-card__price">{formatPrice(tier.price, currency)}</span>
              )}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
