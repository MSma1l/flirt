/** Rând din lista de dialoguri: avatar-inițială, nume, preview, timp, badge unread. */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@theme/index';

import { compatColor, compatLabel } from '@/features/feed/compat';
import { useLanguage } from '@/i18n/useLanguage';

import { ChatSummary } from './types';

interface Props {
  chat: ChatSummary;
  /** Primește `chatId` ca să poată fi o funcție stabilă (memoizată) în părinte,
   *  fără a recrea un closure per rând la fiecare poll. */
  onPress: (chatId: string) => void;
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

function ChatListItemBase({ chat, onPress }: Props) {
  const { colors, typography, spacing, radius } = useTheme();
  // Textele rândului sunt în `chat`; eticheta de compatibilitate vine din
  // `feed`, unde stă și regula scorului — de acolo prefixul explicit `feed:`.
  const { t } = useTranslation(['chat', 'feed']);
  const { current: language } = useLanguage();
  const hasUnread = chat.unreadCount > 0;

  /**
   * Timp scurt relativ: „acum", „5 min", „3 h", „2 z" sau data.
   *
   * Stă ÎN componentă, nu lângă ea: are nevoie de `t` și de limba activă. Data
   * de peste o săptămână se formatează cu limba interfeței, nu fix cu `ro-RO` —
   * altfel un user rus vedea „3 sept." în română.
   */
  const shortTime = (iso?: string): string => {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const diffMin = Math.floor((Date.now() - then) / 60000);
    if (diffMin < 1) return t('list.time.now');
    if (diffMin < 60) return t('list.time.minutes', { value: diffMin });
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return t('list.time.hours', { value: diffH });
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return t('list.time.days', { value: diffD });
    return new Date(iso).toLocaleDateString(language, { day: 'numeric', month: 'short' });
  };

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onPress(chat.chatId)}
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
          <View
            testID="compat-pill"
            accessibilityRole="text"
            accessibilityLabel={t('feed:compat.badge', {
              level: t(`feed:${compatLabel(chat.compatibility)}`),
              score: chat.compatibility,
            })}
            style={[
              styles.compat,
              { backgroundColor: compatColor(chat.compatibility, colors), borderRadius: radius.pill },
            ]}
          >
            <Text style={[typography.badge, { color: colors.onAccent }]}>
              {chat.compatibility}%
            </Text>
          </View>
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
            {chat.lastMessage ?? t('list.noMessages')}
          </Text>
          {hasUnread ? (
            <View
              accessibilityLabel={t('list.unread', { count: chat.unreadCount })}
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

/** Memoizat: la fiecare poll al listei, un rând nemodificat nu se re-randează
 *  (props stabile — `onPress` vine memoizat din părinte). */
export const ChatListItem = React.memo(ChatListItemBase);

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
  compat: {
    height: 20,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
