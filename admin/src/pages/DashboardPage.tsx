/**
 * Panoul de bord: cifrele curente + evoluția lor în timp.
 * Graficele folosesc recharts (bibliotecă ușoară, fără framework în spate).
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { fetchStats, fetchTimeseries } from '../api/admin';
import { Card, ErrorState, LoadingState, Select, StatCard } from '../components/ui';
import { useMessages } from '../i18n/LanguageContext';
import { coreMessages } from '../i18n/messages/core';
import { errorMessage } from '../lib/errors';
import { formatEur, formatNumber, formatShortDate } from '../lib/format';

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

/** Culori din paleta FLIRT (tokens.css) — nu inventăm nuanțe noi. */
const ACCENT = '#ff2d78';
const SUCCESS = '#2ecc71';
const NEUTRAL = '#8a8a94';

export function DashboardPage(): JSX.Element {
  const m = useMessages(coreMessages).dashboard;
  const [days, setDays] = useState<Range>(30);

  const statsQuery = useQuery({ queryKey: ['stats'], queryFn: fetchStats });
  const seriesQuery = useQuery({
    queryKey: ['stats', 'timeseries', days],
    queryFn: () => fetchTimeseries(days),
  });

  if (statsQuery.isPending) return <LoadingState label={m.loading} />;
  if (statsQuery.isError) {
    return (
      <ErrorState
        message={errorMessage(statsQuery.error)}
        onRetry={() => void statsQuery.refetch()}
      />
    );
  }

  const stats = statsQuery.data;
  const series = (seriesQuery.data ?? []).map((point) => ({
    ...point,
    label: formatShortDate(point.date),
  }));

  return (
    <>
      <div className="stat-grid">
        <StatCard
          label={m.users}
          value={formatNumber(stats.users_total)}
          hint={m.usersNew(stats.users_new_7d)}
        />
        <StatCard
          label={m.active}
          value={formatNumber(stats.users_active_24h)}
          hint={m.banned(stats.users_banned)}
        />
        <StatCard
          label={m.matches}
          value={formatNumber(stats.matches_total)}
          hint={m.matches24h(stats.matches_24h)}
        />
        <StatCard
          label={m.reportsPending}
          value={formatNumber(stats.reports_pending)}
          hint={m.reportsHint}
          accent={stats.reports_pending > 0}
        />
        <StatCard
          label={m.subscriptions}
          value={formatNumber(stats.subscriptions_active)}
        />
        <StatCard
          label={m.revenue}
          value={formatEur(stats.revenue_estimated_eur)}
          hint={m.revenueHint}
        />
      </div>

      <div className="section-head">
        <h2 className="card__title" style={{ margin: 0 }}>
          {m.trend}
        </h2>
        <Select
          aria-label={m.range}
          value={days}
          onChange={(event) => setDays(Number(event.target.value) as Range)}
          style={{ width: 160 }}
        >
          {RANGES.map((range) => (
            <option key={range} value={range}>
              {m.lastDays(range)}
            </option>
          ))}
        </Select>
      </div>

      {seriesQuery.isError ? (
        <ErrorState
          message={errorMessage(seriesQuery.error)}
          onRetry={() => void seriesQuery.refetch()}
        />
      ) : (
        <div className="chart-grid">
          <Card title={m.chartUsers} className="chart-card">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={series}>
                <defs>
                  <linearGradient id="usersFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ACCENT} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="label" stroke="var(--color-text-secondary)" fontSize={12} />
                <YAxis stroke="var(--color-text-secondary)" fontSize={12} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 12,
                    color: 'var(--color-text)',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="users"
                  name={m.seriesUsers}
                  stroke={ACCENT}
                  fill="url(#usersFill)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          <Card title={m.chartMatches} className="chart-card">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={series}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="label" stroke="var(--color-text-secondary)" fontSize={12} />
                <YAxis stroke="var(--color-text-secondary)" fontSize={12} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 12,
                    color: 'var(--color-text)',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="matches"
                  name={m.seriesMatches}
                  stroke={SUCCESS}
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="reports"
                  name={m.seriesReports}
                  stroke={NEUTRAL}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}
    </>
  );
}
