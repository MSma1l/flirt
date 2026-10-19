/**
 * Centrul de activitate: „ce s-a întâmplat cu profilul meu".
 *
 * Sus, statisticile (vizualizări total + ultimele 7 zile, like-uri, super
 * like-uri, match-uri, dislike-uri). Dedesubt, cronologia: match-uri noi,
 * like-uri și super like-uri primite, vizualizările agregate pe zi.
 *
 * Reguli de confidențialitate (impuse de server, respectate și aici):
 *   - dislike-urile sunt DOAR un număr — nu există rând de listă pentru ele;
 *   - vizualizările sunt DOAR un număr pe zi — niciodată cine;
 *   - cine ți-a dat like e vizibil, ca în inboxul de cereri (fără paywall).
 *
 * CITIT: la prima încărcare mutăm semnul de citire la cel mai nou element
 * afișat. Rândurile își păstrează însă marcajul „Nou" cât timp ecranul e
 * deschis — altfel utilizatorul n-ar mai ști ce era nou exact când se uită.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Icon, type IconName } from '@/components/icons';
import { StatusScreen } from '@/components/StatusScreen';
import { chatPath } from '@/features/chat/chatRoutes';

import {
  ACTIVITY_UNREAD_KEY,
  markActivityRead,
  useActivityFeed,
  type ActivityItem,
  type ActivityStats,
} from './activityApi';
import { formatRelative } from './relativeTime';
import './activity.css';

function initials(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

function StatsPanel({ stats }: { stats: ActivityStats }) {
  const { t } = useTranslation('miniapp');
  const tiles: { key: string; icon: IconName; value: number; label: string; tone: string }[] = [
    { key: 'likes', icon: 'heart', value: stats.likes, label: t('activity.stats.likes'), tone: 'like' },
    {
      key: 'superLikes',
      icon: 'star',
      value: stats.superLikes,
      label: t('activity.stats.superLikes'),
      tone: 'super',
    },
    { key: 'matches', icon: 'chat', value: stats.matches, label: t('activity.stats.matches'), tone: 'match' },
    {
      key: 'dislikes',
      icon: 'block',
      value: stats.dislikes,
      label: t('activity.stats.dislikes'),
      tone: 'nope',
    },
  ];

  return (
    <section className="activity-stats" aria-label={t('activity.statsTitle')} data-testid="activity-stats">
      <h2 className="activity-section-title">{t('activity.statsTitle')}</h2>
      <div className="activity-stat activity-stat--hero" data-testid="activity-stat-views">
        <span className="activity-stat__icon" aria-hidden="true">
          <Icon name="eye" />
        </span>
        <div className="activity-stat__text">
          <span className="activity-stat__value">{stats.viewsTotal}</span>
          <span className="activity-stat__label">{t('activity.stats.views')}</span>
        </div>
        <span className="activity-stat__delta" data-testid="activity-stat-views-week">
          {t('activity.stats.viewsWeek', { count: stats.viewsLast7Days })}
        </span>
      </div>
      <div className="activity-stats__grid">
        {tiles.map((tile) => (
          <div
            key={tile.key}
            className={`activity-stat activity-stat--${tile.tone}`}
            data-testid={`activity-stat-${tile.key}`}
          >
            <span className="activity-stat__icon" aria-hidden="true">
              <Icon name={tile.icon} />
            </span>
            <span className="activity-stat__value">{tile.value}</span>
            <span className="activity-stat__label">{tile.label}</span>
          </div>
        ))}
      </div>
      <p className="activity-note">{t('activity.dislikesNote')}</p>
    </section>
  );
}

function ItemAvatar({ item }: { item: ActivityItem }) {
  if (item.kind === 'views' || !item.actor) {
    return (
      <span className="activity-avatar activity-avatar--icon" aria-hidden="true">
        <Icon name="eye" />
      </span>
    );
  }
  const badge: IconName | null =
    item.kind === 'super_like' ? 'star' : item.kind === 'match' ? 'heart' : null;
  return (
    <span className={`activity-avatar activity-avatar--${item.kind}`} aria-hidden="true">
      {item.actor.photo ? (
        <img src={item.actor.photo} alt="" draggable={false} />
      ) : (
        <span className="activity-avatar__initial">{initials(item.actor.name)}</span>
      )}
      {badge ? (
        <span className="activity-avatar__badge">
          <Icon name={badge} />
        </span>
      ) : null}
    </span>
  );
}

function ActivityRow({ item, language }: { item: ActivityItem; language: string }) {
  const { t } = useTranslation('miniapp');
  const text =
    item.kind === 'views'
      ? t('activity.item.views', { count: item.count ?? 0 })
      : t(`activity.item.${item.kind}`, { name: item.actor?.name ?? '' });
  const unread = !item.isRead;

  const content = (
    <>
      <ItemAvatar item={item} />
      <span className="activity-row__body">
        <span className="activity-row__text">{text}</span>
        <span className="activity-row__meta">
          <time dateTime={item.occurredAt}>{formatRelative(item.occurredAt, language)}</time>
          {unread ? <span className="activity-row__new">{t('activity.new')}</span> : null}
        </span>
      </span>
      {item.kind === 'match' && item.chatId ? (
        <Icon name="chevron" className="activity-row__chevron" />
      ) : unread ? (
        <span className="activity-row__dot" aria-hidden="true" />
      ) : null}
    </>
  );

  const className = `activity-row activity-row--${item.kind}${unread ? ' activity-row--unread' : ''}`;
  return (
    <li data-testid="activity-row" data-kind={item.kind} data-unread={unread ? 'true' : 'false'}>
      {item.kind === 'match' && item.chatId ? (
        <Link
          to={chatPath(item.chatId)}
          className={className}
          aria-label={`${text} — ${t('activity.openChat')}`}
        >
          {content}
        </Link>
      ) : (
        <div className={className}>{content}</div>
      )}
    </li>
  );
}

export function ActivityScreen() {
  const { t, i18n } = useTranslation('miniapp');
  const queryClient = useQueryClient();
  const query = useActivityFeed();

  // Semnul de citire se mută O DATĂ pe deschidere, după prima pagină.
  const markedRef = useRef(false);
  const firstPage = query.data?.pages[0];
  useEffect(() => {
    if (!firstPage || markedRef.current) return;
    markedRef.current = true;
    if (firstPage.unread === 0) {
      queryClient.setQueryData(ACTIVITY_UNREAD_KEY, 0);
      return;
    }
    // Până la cel mai nou element AFIȘAT: ce sosește între timp rămâne necitit.
    markActivityRead(firstPage.items[0]?.occurredAt)
      .then((unread) => queryClient.setQueryData(ACTIVITY_UNREAD_KEY, unread))
      .catch(() => undefined);
  }, [firstPage, queryClient]);

  if (query.isLoading) {
    return <StatusScreen loading testId="activity-loading" title={t('activity.loading')} />;
  }

  if (query.isError || !query.data) {
    return (
      <StatusScreen
        testId="activity-error"
        title={t('errors.network.title')}
        body={t('activity.error')}
        actions={[
          {
            label: t('actions.retry', { ns: 'common' }),
            onClick: () => void query.refetch(),
            testId: 'activity-retry',
          },
        ]}
      />
    );
  }

  const stats = query.data.pages[0]?.stats ?? null;
  const items = query.data.pages.flatMap((page) => page.items);

  return (
    <div className="activity-screen" data-testid="activity-screen">
      {stats ? <StatsPanel stats={stats} /> : null}

      <section className="activity-list-section" aria-label={t('activity.listTitle')}>
        <h2 className="activity-section-title">{t('activity.listTitle')}</h2>
        {items.length === 0 ? (
          <div className="activity-empty" data-testid="activity-empty">
            <span className="activity-empty__icon" aria-hidden="true">
              <Icon name="bell" />
            </span>
            <p className="activity-empty__title">{t('activity.emptyTitle')}</p>
            <p className="activity-empty__body">{t('activity.emptyBody')}</p>
          </div>
        ) : (
          <ul className="activity-list">
            {items.map((item) => (
              <ActivityRow key={item.id} item={item} language={i18n.language} />
            ))}
          </ul>
        )}
        {query.hasNextPage ? (
          <button
            type="button"
            className="button button--ghost activity-more"
            data-testid="activity-more"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t('activity.loadMore')}
          </button>
        ) : null}
      </section>
    </div>
  );
}

export default ActivityScreen;
