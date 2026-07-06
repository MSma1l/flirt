/** Rând din lista de dialoguri: avatar-inițială, nume, preview, timp, badge unread. */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@theme/index';

import { ChatSummary } from './types';

interface Props {
  chat: ChatSummary;
  onPress: () => void;
}

/** Timp scurt relativ: „acum", „5 min", „3 h", „2 z" sau data. */
function shortTime(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMin = Math.floor((Date.now() - then) / 60000);
  if (diffMin < 1) return 'acum';
  if (diffMin < 60) return `${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD} z`;
  return new Date(iso).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' });
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

export function ChatListItem({ chat, onPress }: Props) {
  const { colors, typography, spacing, radius } = useTheme();
  const hasUnread = chat.unreadCount > 0;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? colors.surfaceHover : colors.surface,
          borderColor: colors.border,
          borderRadius: radius.md,
          padding: spacing.md,
          gap: spacing.md,
        },
      ]}
    >
      <View
        style={[styles.avatar, { backgroundColor: colors.tagBg, borderRadius: radius.pill }]}
      >
        <Text style={[typography.h2, { color: colors.accent }]}>{initial(chat.otherName)}</Text>
      </View>

      <View style={styles.body}>
        <View style={styles.topLine}>
          <Text
            numberOfLines={1}
            style={[typography.bodyStrong, styles.name, { color: colors.textPrimary }]}
          >
            {chat.otherName}
          </Text>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {shortTime(chat.lastMessageAt)}
          </Text>
        </View>

        <View style={styles.bottomLine}>
          <Text
            numberOfLines={1}
            style={[
              typography.caption,
              styles.preview,
              { color: hasUnread ? colors.textPrimary : colors.textSecondary },
            ]}
          >
            {chat.lastMessage ?? 'Niciun mesaj încă'}
          </Text>
          {hasUnread ? (
            <View
              accessibilityLabel={`${chat.unreadCount} mesaje necitite`}
              style={[styles.badge, { backgroundColor: colors.accent, borderRadius: radius.pill }]}
            >
              <Text style={[typography.badge, { color: colors.onAccent }]}>
                {chat.unreadCount}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  avatar: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 4,
  },
  topLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  name: {
    flex: 1,
  },
  bottomLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  preview: {
    flex: 1,
  },
  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
