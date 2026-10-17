/**
 * Piese comune paginilor de bilete (Comenzi + Cereri): tonul badge-urilor de
 * stare, starea biletului emis, vizualizatorul de chitanță (mare, cu zoom) și
 * reîmprospătarea TUTUROR listelor după o decizie (altfel o comandă aprobată din
 * „Cereri" rămâne „de verificat" în „Comenzi", iar contorul din meniu minte).
 */
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { fetchEvents } from '../api/admin';
import { ApiError } from '../api/client';
import type { TicketLifecycleStatus, TicketOrderStatus } from '../api/types';
import { Badge, Button, LoadingState, type BadgeTone } from '../components/ui';
import { useMessages } from '../i18n/LanguageContext';
import { ticketsMessages } from '../i18n/messages/tickets';
import { errorMessage } from '../lib/errors';
import { formatDateTime, formatTime } from '../lib/format';

/**
 * Culoarea stării (comandă sau cerere — aceeași tabelă pe backend):
 * galben = cere acțiunea adminului, verde = bilet emis, roșu = respinsă,
 * neutru = așteaptă clientul sau e închisă.
 */
export const STATUS_TONE: Record<TicketOrderStatus, BadgeTone> = {
  awaiting_payment: 'neutral',
  pending_payment: 'neutral',
  payment_declared: 'warning',
  payment_proof_submitted: 'warning',
  under_review: 'warning',
  additional_information_required: 'accent',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

/** Stările care cer acțiunea adminului (plata/chitanța de verificat). */
export const TO_VERIFY: readonly TicketOrderStatus[] = [
  'payment_declared',
  'payment_proof_submitted',
  'under_review',
];

export function needsAction(status: string): boolean {
  return (TO_VERIFY as readonly string[]).includes(status);
}

const TICKET_TONE: Record<TicketLifecycleStatus, BadgeTone> = {
  valid: 'success',
  admitted: 'accent',
  used: 'neutral',
  expired: 'neutral',
  cancelled: 'danger',
};

/** Starea biletului emis („Bilet valid", „A intrat la 21:04"…). */
export function TicketStatusBadge({
  status,
  admittedAt,
}: {
  status: TicketLifecycleStatus | null | undefined;
  admittedAt?: string | null;
}): JSX.Element | null {
  const m = useMessages(ticketsMessages).ticket;
  if (!status) return null;
  const label =
    status === 'admitted' && admittedAt ? m.admittedAt(formatTime(admittedAt)) : m.status[status];
  return <Badge tone={TICKET_TONE[status] ?? 'neutral'}>{label}</Badge>;
}

/** Toate cozile de bilete + contoarele care depind de ele. */
export async function refreshTicketQueries(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['ticket-orders'] }),
    queryClient.invalidateQueries({ queryKey: ['ticket-order'] }),
    queryClient.invalidateQueries({ queryKey: ['ticket-requests'] }),
    queryClient.invalidateQueries({ queryKey: ['ticket-request'] }),
    queryClient.invalidateQueries({ queryKey: ['stats'] }),
    queryClient.invalidateQueries({ queryKey: ['events'] }),
  ]);
}

/**
 * Eroarea unei acțiuni pe bilete, pentru admin. `tickets_sold_out` (409) primește
 * un mesaj clar — capacitatea evenimentului e atinsă — nu textul brut al serverului.
 */
export function useTicketActionError(): (error: unknown) => string {
  const soldOut = useMessages(ticketsMessages).common.soldOut;
  return (error: unknown) =>
    error instanceof ApiError && error.code === 'tickets_sold_out' ? soldOut : errorMessage(error);
}

export interface EventOption {
  id: string;
  label: string;
}

/**
 * Evenimentele pentru filtrul „Eveniment" (cele mai noi primele), cu data în
 * fusul din Chișinău. `extra` = evenimente văzute în listă, dar care nu sunt în
 * prima pagină de evenimente (altfel opțiunea aleasă ar dispărea).
 */
export function useEventOptions(extra: readonly { id: string; title: string; starts_at?: string | null }[] = []): {
  options: EventOption[];
  isError: boolean;
} {
  const query = useQuery({
    queryKey: ['events', 'options'],
    queryFn: () => fetchEvents(undefined, 100),
    staleTime: 5 * 60_000,
  });
  const options = useMemo(() => {
    const byId = new Map<string, { title: string; starts_at: string | null }>();
    for (const event of query.data?.items ?? []) {
      byId.set(event.id, { title: event.title, starts_at: event.starts_at });
    }
    for (const event of extra) {
      if (!byId.has(event.id)) byId.set(event.id, { title: event.title, starts_at: event.starts_at ?? null });
    }
    return Array.from(byId, ([id, e]) => ({ id, ...e }))
      .sort((a, b) => (b.starts_at ?? '').localeCompare(a.starts_at ?? ''))
      .map((e) => ({ id: e.id, label: e.starts_at ? `${e.title} · ${formatDateTime(e.starts_at)}` : e.title }));
  }, [query.data, extra]);
  return { options, isError: query.isError };
}

/** Un rând etichetă/valoare în detaliul comenzii. */
export function DetailRow({ label, value }: { label: string; value: ReactNode }): JSX.Element {
  return (
    <div className="ticket-facts__row">
      <dt className="muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

const MAX_ZOOM = 4;

/**
 * Chitanța: imagine MARE cu zoom (butoane sau click) și deschidere la mărime
 * completă, ori link spre PDF. Fișierul e privat → citit autentificat ca Blob.
 * `version` forțează recitirea când clientul încarcă o chitanță nouă.
 */
export function ProofViewer({
  load,
  kind,
  version,
}: {
  load: () => Promise<Blob>;
  kind: 'image' | 'pdf' | null | undefined;
  version: string;
}): JSX.Element {
  const m = useMessages(ticketsMessages).proof;
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [isPdf, setIsPdf] = useState(kind === 'pdf');

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    setError(null);
    setZoom(1);
    void load()
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        // Serverul vechi nu trimite `payment_proof_kind`: tipul Blob-ului decide.
        setIsPdf(kind === 'pdf' || blob.type === 'application/pdf');
        setUrl(objectUrl);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError && err.status === 404 ? m.missing : errorMessage(err));
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // `load` e o funcție nouă la fiecare randare; identitatea dovezii e `version`.
  }, [version]);

  return (
    <section className="ticket-proof" aria-label={m.title}>
      <div className="ticket-proof__head">
        <h3 className="card__title" style={{ margin: 0 }}>
          {m.title}
        </h3>
        {url && !isPdf ? (
          <div className="table__actions">
            <Button
              small
              variant="ghost"
              onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
              disabled={zoom <= 1}
            >
              {m.zoomOut}
            </Button>
            <Button
              small
              variant="ghost"
              onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 0.5))}
              disabled={zoom >= MAX_ZOOM}
            >
              {m.zoomIn}
            </Button>
            <a className="btn btn--ghost btn--sm" href={url} target="_blank" rel="noopener noreferrer">
              {m.openFull}
            </a>
          </div>
        ) : null}
      </div>
      {error ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : null}
      {!url && !error ? <LoadingState label={m.loading} /> : null}
      {url && isPdf ? (
        <a
          className="btn btn--primary"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="proof-pdf-link"
        >
          {m.openPdf}
        </a>
      ) : null}
      {url && !isPdf ? (
        <div className="ticket-proof__frame">
          <img
            src={url}
            alt={m.alt}
            data-testid="proof-image"
            onClick={() => setZoom((z) => (z >= 2 ? 1 : 2))}
            style={{
              width: `${zoom * 100}%`,
              maxWidth: zoom === 1 ? '100%' : 'none',
              cursor: zoom >= 2 ? 'zoom-out' : 'zoom-in',
            }}
          />
        </div>
      ) : null}
    </section>
  );
}

/** Butoanele-filtru pe stare, cu numărul de rânduri din fiecare. */
export function StatusChips<K extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { key: K; label: string; count?: string | null; urgent?: boolean }[];
  value: K;
  onChange: (key: K) => void;
}): JSX.Element {
  return (
    <div className="ticket-chips" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className={[
            'ticket-chip',
            option.key === value ? 'ticket-chip--active' : '',
            option.urgent ? 'ticket-chip--urgent' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-pressed={option.key === value}
          onClick={() => onChange(option.key)}
        >
          <span>{option.label}</span>
          {option.count ? (
            <span className="ticket-chip__count" data-testid={`chip-count-${option.key}`}>
              {option.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
