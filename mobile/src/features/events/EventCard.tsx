/** Card de eveniment: copertă placeholder colorată după tip, titlu, dată, loc, badge, participanți. */
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { ThemeColors } from '@theme/colors';
import { useTheme } from '@theme/index';

import { EventItem } from './types';

/** Eticheta în română pentru un tip de eveniment. */
export function kindLabel(kind: string): string {
  switch (kind) {
    case 'flirt_party':
      return 'Flirt Party';
    case 'concert':
      return 'Concert';
    default:
      return 'Eveniment';
  }
}

/** Culoare din temă pentru coperta/badge-ul unui tip de eveniment. */
export function kindColor(kind: string, colors: ThemeColors): string {
  switch (kind) {
    case 'flirt_party':
      return colors.accent;
    case 'concert':
      return colors.link;
    default:
      return colors.surfaceHover;
  }
}

/** Formatează o dată ISO în text `ro-RO` (zi, lună, oră). */
export function formatEventDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return date.toLocaleDateString('ro-RO', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return date.toISOString();
  }
}

interface Props {
  event: EventItem;
}

export function EventCard({ event }: Props) {
  const { colors, typography, radius, spacing } = useTheme();
  const cover = kindColor(event.kind, colors);
  const label = kindLabel(event.kind);
  const hasCover = !!event.coverUrl;

  return (
    <View
      accessibilityRole="button"
      accessibilityLabel={event.title}
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radius.card,
        },
      ]}
    >
      {/* Copertă: imagine sau placeholder colorat după tip */}
      <View style={[styles.cover, { backgroundColor: cover }]}>
        {hasCover ? (
          <Image
            source={{ uri: event.coverUrl }}
            style={styles.coverImage}
            resizeMode="cover"
          />
        ) : null}

        {/* Badge de tip sus-stânga */}
        <View
          style={[
            styles.badge,
            {
              backgroundColor: colors.bg,
              borderRadius: radius.pill,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.xs,
            },
          ]}
        >
          <Text style={[typography.badge, { color: colors.textPrimary }]}>{label}</Text>
        </View>

        {/* Indicator „Mergi" sus-dreapta */}
        {event.iAmGoing ? (
          <View
            style={[
              styles.going,
              {
                backgroundColor: colors.accent,
                borderRadius: radius.pill,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs,
              },
            ]}
          >
            <Text style={[typography.badge, { color: colors.onAccent }]}>Mergi</Text>
          </View>
        ) : null}
      </View>

      {/* Detalii text */}
      <View style={{ padding: spacing.lg }}>
        <Text
          numberOfLines={2}
          style={[typography.h2, { color: colors.textPrimary }]}
        >
          {event.title}
        </Text>

        <Text
          style={[
            typography.caption,
            { color: colors.textSecondary, marginTop: spacing.xs },
          ]}
        >
          {formatEventDate(event.startsAt)}
        </Text>

        <Text
          style={[
            typography.caption,
            { color: colors.textSecondary, marginTop: spacing.xs },
          ]}
        >
          {event.venue} · {event.city}
        </Text>

        <Text
          style={[
            typography.caption,
            { color: colors.link, marginTop: spacing.sm },
          ]}
        >
          {event.attendeeCount} participanți
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    overflow: 'hidden',
  },
  cover: {
    height: 140,
    justifyContent: 'flex-start',
  },
  coverImage: {
    ...StyleSheet.absoluteFillObject,
  },
  badge: {
    position: 'absolute',
    top: 12,
    left: 12,
  },
  going: {
    position: 'absolute',
    top: 12,
    right: 12,
  },
});
