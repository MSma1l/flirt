/**
 * Coada de moderare — ecranul operațional cel mai important.
 *
 * Apple (App Store Review 1.2 — User-Generated Content) cere ca un raport de
 * conținut abuziv să primească răspuns în ≤24h. De aceea: coada e sortată de
 * backend „cele mai vechi întâi", timpul scurs e vizibil pe fiecare intrare, iar
 * acțiunile sunt la un click distanță — dar NICIUNA nu se execută fără confirmare.
 */
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { fetchReports, resolveReport } from '../api/admin';
import type { AdminReport, ResolveAction } from '../api/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { formatDateTime, formatRelative } from '../lib/format';

interface PendingAction {
  report: AdminReport;
  action: ResolveAction;
}

const ACTION_COPY: Record<
  ResolveAction,
  { title: string; message: string; confirm: string; danger: boolean }
> = {
  ban: {
    title: 'Banează contul raportat',
    message:
      'Contul va fi banat: nu se mai poate autentifica, iar profilul dispare din feed. Acțiunea poate fi anulată ulterior din ecranul Utilizatori (deban).',
    confirm: 'Banează contul',
    danger: true,
  },
  hide: {
    title: 'Ascunde profilul',
    message:
      'Profilul nu va mai apărea în feed, dar contul rămâne activ. Folosește-o când conținutul e problematic, dar nu justifică un ban.',
    confirm: 'Ascunde profilul',
    danger: true,
  },
  dismiss: {
    title: 'Respinge raportul',
    message:
      'Raportul se închide fără nicio măsură împotriva contului raportat. Rămâne în jurnalul de audit.',
    confirm: 'Respinge raportul',
    danger: false,
  },
};

export function ModerationPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useInfiniteQuery({
    queryKey: ['reports', 'open'],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      fetchReports({ status: 'open', cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });

  const reports: AdminReport[] = query.data?.pages.flatMap((page) => page.items) ?? [];
  const selected = reports.find((report) => report.id === selectedId) ?? reports[0] ?? null;

  const resolve = useMutation({
    mutationFn: ({ report, action, reason }: PendingAction & { reason?: string }) =>
      resolveReport(report.id, action, reason),
    onSuccess: async () => {
      setPending(null);
      setActionError(null);
      setSelectedId(null);
      await queryClient.invalidateQueries({ queryKey: ['reports'] });
      await queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
    onError: (error: unknown) => setActionError(errorMessage(error)),
  });

  if (query.isPending) return <LoadingState label="Se încarcă coada de moderare…" />;
  if (query.isError) {
    return <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  }

  if (reports.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Coada e goală"
          hint="Nu există rapoarte în așteptare. Rapoartele noi apar aici automat."
        />
      </Card>
    );
  }

  const copy = pending ? ACTION_COPY[pending.action] : null;

  return (
    <div className="moderation">
      <Card title={`Rapoarte deschise (${reports.length})`}>
        <div className="queue">
          {reports.map((report) => {
            const isActive = selected?.id === report.id;
            return (
              <button
                key={report.id}
                type="button"
                className={isActive ? 'queue__item queue__item--active' : 'queue__item'}
                onClick={() => setSelectedId(report.id)}
                aria-current={isActive}
              >
                <div className="queue__head">
                  <span className="queue__name">
                    {report.reported?.name ?? report.reported?.email ?? 'Profil necunoscut'}
                  </span>
                  <Badge tone={report.reporters_count > 1 ? 'danger' : 'neutral'}>
                    {report.reporters_count} raportări
                  </Badge>
                </div>
                <div className="queue__head">
                  <Badge tone="warning">{report.category}</Badge>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {formatRelative(report.created_at)}
                  </span>
                </div>
                {report.note ? <span className="queue__note">{report.note}</span> : null}
              </button>
            );
          })}
        </div>

        {query.hasNextPage ? (
          <div className="pagination">
            <span />
            <Button
              small
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
            >
              {query.isFetchingNextPage ? 'Se încarcă…' : 'Încarcă mai multe'}
            </Button>
          </div>
        ) : null}
      </Card>

      {selected ? (
        <Card title="Profil raportat">
          <dl className="detail-rows">
            <div className="detail-row">
              <dt>Nume</dt>
              <dd>{selected.reported?.name ?? '—'}</dd>
            </div>
            <div className="detail-row">
              <dt>Email</dt>
              <dd>{selected.reported?.email ?? '—'}</dd>
            </div>
            <div className="detail-row">
              <dt>Vârstă / oraș</dt>
              <dd>
                {selected.reported?.age ?? '—'} · {selected.reported?.city ?? '—'}
              </dd>
            </div>
            <div className="detail-row">
              <dt>Descriere</dt>
              <dd>{selected.reported?.about ?? '—'}</dd>
            </div>
            <div className="detail-row">
              <dt>Motiv raport</dt>
              <dd>
                <Badge tone="warning">{selected.category}</Badge>
              </dd>
            </div>
            <div className="detail-row">
              <dt>Nota raportorului</dt>
              <dd>{selected.note ?? '—'}</dd>
            </div>
            <div className="detail-row">
              <dt>Raportări distincte</dt>
              <dd className="mono">{selected.reporters_count}</dd>
            </div>
            <div className="detail-row">
              <dt>Primit la</dt>
              <dd>{formatDateTime(selected.created_at)}</dd>
            </div>
            <div className="detail-row">
              <dt>Stare cont</dt>
              <dd>
                {selected.reported?.banned_at ? (
                  <Badge tone="danger">Banat</Badge>
                ) : (
                  <Badge tone="success">Activ</Badge>
                )}
              </dd>
            </div>
          </dl>

          {selected.reported && selected.reported.photos.length > 0 ? (
            <div className="photos" style={{ marginTop: 'var(--space-4)' }}>
              {selected.reported.photos.slice(0, 6).map((url) => (
                <img key={url} src={url} alt="Fotografie din profilul raportat" loading="lazy" />
              ))}
            </div>
          ) : null}

          <div className="actions-row">
            <Button
              variant="danger"
              onClick={() => {
                setActionError(null);
                setPending({ report: selected, action: 'ban' });
              }}
            >
              Banează contul
            </Button>
            <Button
              onClick={() => {
                setActionError(null);
                setPending({ report: selected, action: 'hide' });
              }}
            >
              Ascunde profilul
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setActionError(null);
                setPending({ report: selected, action: 'dismiss' });
              }}
            >
              Respinge raportul
            </Button>
          </div>
        </Card>
      ) : null}

      {pending && copy ? (
        <ConfirmDialog
          title={copy.title}
          message={copy.message}
          confirmLabel={copy.confirm}
          danger={copy.danger}
          reasonLabel="Motiv (opțional)"
          busy={resolve.isPending}
          errorMessage={actionError}
          onCancel={() => {
            setPending(null);
            setActionError(null);
          }}
          onConfirm={(reason) => {
            resolve.mutate({ ...pending, reason: reason || undefined });
          }}
        />
      ) : null}
    </div>
  );
}
