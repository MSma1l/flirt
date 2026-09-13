/**
 * Blocul de preț: ce se vede din defalcarea trimisă de server.
 *
 * Componenta nu are voie să calculeze nimic. Testele de mai jos îi dau cifre
 * INCOERENTE intenționat (un preț final care nu iese din procent) și verifică
 * faptul că le afișează ca atare: dacă cineva introduce vreodată o înmulțire
 * aici, testul cade — exact ce vrem, fiindcă prețul înscris pe comandă îl
 * calculează `ticket_order_service.create_order`, nu ecranul.
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/harness';

import type { TicketQuote } from '../loyaltyApi';
import { TicketPriceBlock } from '../TicketPrice';

const BASE: TicketQuote = {
  eventId: 'e1',
  basePrice: 250,
  currency: 'lei',
  loyaltyPercent: 0,
  promoPercent: 0,
  invitePercent: 0,
  appliedPercent: 0,
  appliedSource: 'none',
  capped: false,
  discountAmount: 0,
  finalPrice: 250,
  tier: null,
};

const GOLD = { code: 'gold', name: 'Aur', minStamps: 12, discountPercent: 20 };

describe('cu reducere', () => {
  it('arată prețul final, prețul întreg tăiat și procentul', () => {
    renderWithProviders(
      <TicketPriceBlock
        quote={{
          ...BASE,
          loyaltyPercent: 20,
          appliedPercent: 20,
          appliedSource: 'loyalty',
          discountAmount: 50,
          finalPrice: 200,
          tier: GOLD,
        }}
      />,
    );

    expect(screen.getByTestId('ticket-quote-final')).toHaveTextContent('200 lei');
    const struck = screen.getByTestId('ticket-quote-base');
    expect(struck).toHaveTextContent('250 lei');
    expect(struck.tagName).toBe('S');
    expect(screen.getByTestId('ticket-quote')).toHaveTextContent('−20% reducere');
  });

  it('afișează cifrele serverului fără să le verifice sau să le recalculeze', () => {
    // Preț final care NU iese din procent: singura sursă de adevăr e serverul.
    renderWithProviders(
      <TicketPriceBlock
        quote={{ ...BASE, appliedPercent: 10, appliedSource: 'promo', finalPrice: 199.5 }}
      />,
    );

    expect(screen.getByTestId('ticket-quote-final')).toHaveTextContent('199,5 lei');
  });

  it.each([
    ['loyalty' as const, GOLD, 'Preț cu reducerea treptei Aur (−15%).'],
    ['loyalty' as const, null, 'Preț cu reducerea ta de fidelitate (−15%).'],
    ['promo' as const, null, 'Preț cu reducerea promo a evenimentului (−15%).'],
    ['invite' as const, null, 'Preț cu reducerea invitației tale (−15%).'],
  ])('spune de unde vine reducerea (%s)', (source, tier, expected) => {
    renderWithProviders(
      <TicketPriceBlock
        quote={{ ...BASE, appliedPercent: 15, appliedSource: source, finalPrice: 212.5, tier }}
      />,
    );

    expect(screen.getByTestId('ticket-quote-reason')).toHaveTextContent(expected);
  });

  it('plafonul se spune pe față, nu se ascunde', () => {
    renderWithProviders(
      <TicketPriceBlock
        quote={{
          ...BASE,
          promoPercent: 50,
          appliedPercent: 30,
          appliedSource: 'promo',
          capped: true,
          finalPrice: 175,
        }}
      />,
    );

    expect(screen.getByTestId('ticket-quote-capped')).toHaveTextContent(
      'Reducerea este plafonată la 30%.',
    );
  });

  it('are o etichetă de accesibilitate cu ambele prețuri', () => {
    renderWithProviders(
      <TicketPriceBlock
        quote={{ ...BASE, appliedPercent: 20, appliedSource: 'loyalty', finalPrice: 200 }}
      />,
    );

    expect(screen.getByTestId('ticket-quote')).toHaveAccessibleName(
      'Prețul tău este 200 lei, în loc de 250 lei, cu 20 la sută mai puțin',
    );
  });
});

describe('fără reducere', () => {
  it('nu randează nimic: prețul de pe buton e tot adevărul', () => {
    const { container } = renderWithProviders(<TicketPriceBlock quote={BASE} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('nu randează nimic nici când serverul trimite sursa „none" cu procent zero', () => {
    const { container } = renderWithProviders(
      <TicketPriceBlock quote={{ ...BASE, appliedSource: 'none', appliedPercent: 0 }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('nu arată nota de plafon când nu s-a plafonat nimic', () => {
    renderWithProviders(
      <TicketPriceBlock
        quote={{ ...BASE, appliedPercent: 10, appliedSource: 'promo', finalPrice: 225 }}
      />,
    );

    expect(screen.queryByTestId('ticket-quote-capped')).not.toBeInTheDocument();
  });
});
