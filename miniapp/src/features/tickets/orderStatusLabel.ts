/**
 * Eticheta scurtă a stării unei comenzi, în limba interfeței.
 *
 * Stările cumpărării directe refolosesc textele din catalogul mobil `events`
 * (aceleași ca pe cardul de eveniment); cele ale cererii manuale vin din
 * `screens:ticketRequests.status.*`.
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

export function useOrderStatusLabel(): (status: string) => string {
  const { t } = useTranslation(['events', 'social', 'screens']);
  return useCallback(
    (status: string) => {
      switch (status) {
        case 'approved':
          return t('events:detail.ticketStatus.approved');
        case 'payment_declared':
          return t('events:detail.ticketStatus.declared');
        case 'awaiting_payment':
          return t('events:detail.ticketStatus.awaiting');
        case 'rejected':
          return t('social:ticket.rejected.title');
        case 'pending_payment':
        case 'payment_proof_submitted':
        case 'under_review':
        case 'additional_information_required':
        case 'cancelled':
          return t(`screens:ticketRequests.status.${status}`);
        default:
          return t('screens:tickets.statusUnknown');
      }
    },
    [t],
  );
}
