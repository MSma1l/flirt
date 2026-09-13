/**
 * Suprafața publică a modulului de fidelitate.
 *
 * Restul aplicației importă DE AICI, nu din fișierele interne: așa modulul își
 * poate rearanja bucățile fără să atingă ecranele care îl folosesc.
 */
export { InviteRedeemForm } from './InviteRedeemForm';
export { LoyaltyProgress, progressPercent } from './LoyaltyProgress';
export { LoyaltySection } from './LoyaltySection';
export { TicketPriceBlock } from './TicketPrice';

export { formatAmount, formatPrice } from './priceFormat';
export { INVITE_CODE_MAX_LENGTH, normalizeInviteCode } from './inviteCode';
export {
  classifyLoadError,
  loadErrorKey,
  redeemErrorKey,
  RedeemError,
  toRedeemError,
  type LoadErrorKind,
  type RedeemErrorKind,
} from './loyaltyErrors';
export {
  LOYALTY_STATUS_KEY,
  ticketQuoteKey,
  useLoyaltyStatus,
  useRefreshLoyalty,
  useTicketQuote,
} from './useLoyalty';
export {
  fetchLoyaltyStatus,
  fetchTicketQuote,
  redeemInvite,
  type InviteRedemption,
  type LoyaltyStatus,
  type LoyaltyTier,
  type QuoteSource,
  type TicketQuote,
} from './loyaltyApi';
