/**
 * Starea unei comenzi, în cuvinte, în limba interfeței: o etichetă scurtă
 * („Așteaptă plata") și pasul următor („Plătește și încarcă chitanța").
 *
 * Un SINGUR set de texte pentru ambele fluxuri (cumpărare directă și cerere
 * manuală) și pentru toate ecranele (card de eveniment, lista de bilete):
 * înainte, aceeași stare se numea „Bilet: în verificare" într-un loc și
 * „Dovadă trimisă / În verificare" în altul. Logica (ce cheie, ce ton) e pură,
 * în `summarizeOrder`; aici doar se traduce.
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { summarizeOrder, type OrderTone } from './orderStage';
import type { TicketPassStatus } from './ticketsApi';

export interface OrderStatusText {
  label: string;
  next: string;
  tone: OrderTone;
}

export function useOrderStatusText(): (
  order: { status: string; ticketStatus?: TicketPassStatus | null; ticketCode?: string | null },
  eventStarted?: boolean,
) => OrderStatusText {
  const { t } = useTranslation('screens');
  return useCallback(
    (order, eventStarted = false) => {
      const { key, tone } = summarizeOrder(order, eventStarted);
      return {
        label: t(`tickets.status.${key}`),
        next: t(`tickets.next.${key}`),
        tone,
      };
    },
    [t],
  );
}
