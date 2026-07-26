/**
 * Secțiunea „Ți-au dat like" din ecranul Mesaje — cererile de comunicare.
 *
 * Aici sunt userii care I-AU DAT LIKE utilizatorului (cu sau fără mesaj) și la
 * care el nu a răspuns încă. E cea mai importantă zonă a ecranului, deci stă
 * SUS, deasupra tuturor. Spre deosebire de „În așteptare" (like-uri trimise de
 * tine, pasive), aici POȚI acționa: apeși un rând → se deschide ancheta persoanei
 * (`/requests/[userId]`), unde citești mesajul lor și răspunzi cu un mesaj →
 * match + conversație.
 *
 * DECIZIE — secțiune ascunsă când e goală: componenta întoarce `null` dacă nu ai
 * cereri, ca să nu ocupe spațiu mort. Textul de gol apare doar când ecranul ar fi
 * altfel complet gol (`showEmpty`), la fel ca `PendingLikesSection`.
 *
 * Rândurile sunt `Pressable` (spre deosebire de „În așteptare", unde nu duc
 * nicăieri): aici fiecare rând deschide un ecran de detaliu.
 */
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { ReceivedLikeItem, fetchReceivedLikesPage } from '@/features/social/receivedApi';
import { useTheme } from '@theme/index';

/** Avatarul din rând: prima poză a profilului sau inițiala numelui. */
function Avatar({ item }: { item: ReceivedLikeItem }) {
  const { colors, typography, radius } = useTheme();
  const photo = item.profile.photos[0];
  const initial = item.profile.name.trim().charAt(0).toUpperCase() || '?';

  if (photo) {
    return (
      <Image
        source={{ uri: photo }}
        style={[styles.avatar, { borderRadius: radius.pill }]}
        resizeMode="cover"
      />
    );
  }
  return (
    <View
      style={[
        styles.avatar,
        styles.avatarPlaceholder,
        { backgroundColor: colors.tagBg, borderRadius: radius.pill },
      ]}
    >
      <Text style={[typography.bodyStrong, { color: colors.accent }]}>{initial}</Text>
    </View>
  );
}

/** Un rând din „Ți-au dat like": poză, nume+vârstă, badge super, preview mesaj. */
function ReceivedRow({ item, onPress }: { item: ReceivedLikeItem; onPress: () => void }) {
  const { colors, typography, spacing, radius } = useTheme();
  const { t } = useTranslation('chat');

  return (
    <Pressable
      testID={`received-${item.userId}`}
      accessibilityRole="button"
      accessibilityLabel={t('received.open', {
        name: item.profile.name,
        age: item.profile.age,
      })}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? colors.surfaceHover : colors.surface,
          borderColor: colors.border,
          borderRadius: radius.card,
          padding: spacing.lg,
          gap: spacing.md,
        },
      ]}
    >
      <Avatar item={item} />
      <View style={styles.info}>
        <View style={styles.nameLine}>
          <Text
            numberOfLines={1}
            style={[typography.bodyStrong, styles.name, { color: colors.textPrimary }]}
          >
            {item.profile.name}, {item.profile.age}
          </Text>
          {item.isSuper ? (
            <View
              testID={`received-super-${item.userId}`}
              accessibilityLabel="Super like"
              style={[
                styles.superBadge,
                { backgroundColor: colors.tagBg, borderRadius: radius.pill },
              ]}
            >
              <Text style={[typography.badge, { color: colors.accent }]}>
                {t('received.super')}
              </Text>
            </View>
          ) : null}
        </View>

        {item.message ? (
          <Text
            numberOfLines={2}
            testID={`received-message-${item.userId}`}
            style={[typography.caption, { color: colors.textPrimary }]}
          >
            {item.message}
          </Text>
        ) : (
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {t('received.noMessage')}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

export function ReceivedLikesSection({ showEmpty = false }: { showEmpty?: boolean }) {
  const { colors, typography, spacing } = useTheme();
  const { t } = useTranslation('chat');
  const router = useRouter();

  // Paginat pe cursor (`X-Next-Cursor`), la fel ca „În așteptare"/favorite.
  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useInfiniteQuery({
    queryKey: ['social', 'received'],
    queryFn: ({ pageParam }) => fetchReceivedLikesPage({ cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  // Loading DISTINCT de gol: cât aducem prima pagină nu știm dacă e goală.
  if (isLoading) {
    return (
      <View style={[styles.section, { paddingVertical: spacing.md }]}>
        <ActivityIndicator color={colors.accent} testID="received-loading" />
      </View>
    );
  }

  // Eroare DOAR când n-avem nimic de arătat. O eroare la pagina 2 nu șterge
  // pagina 1 — apare în piciorul secțiunii.
  if (isError && data === undefined) {
    return (
      <View style={[styles.section, { gap: spacing.sm }]}>
        <Text style={[typography.h2, { color: colors.textPrimary }]}>{t('received.title')}</Text>
        <Text style={[typography.caption, { color: colors.danger }]} testID="received-error">
          {t('received.loadError')}
        </Text>
        <Button
          label={t('retry')}
          variant="outline"
          onPress={() => refetch()}
          testID="received-retry"
        />
      </View>
    );
  }

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  if (items.length === 0) {
    if (!showEmpty) return null;
    return (
      <View style={[styles.section, { gap: spacing.xs }]}>
        <Text style={[typography.h2, { color: colors.textPrimary }]}>{t('received.title')}</Text>
        <Text
          style={[typography.caption, { color: colors.textSecondary }]}
          testID="received-empty"
        >
          {t('received.empty')}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.section, { gap: spacing.sm }]}>
      <Text style={[typography.h2, { color: colors.textPrimary }]}>{t('received.title')}</Text>
      <Text style={[typography.caption, { color: colors.textSecondary, marginBottom: spacing.xs }]}>
        {t('received.hint')}
      </Text>

      {items.map((item) => (
        <View key={item.userId} style={{ marginBottom: spacing.sm }}>
          <ReceivedRow item={item} onPress={() => router.push(`/requests/${item.userId}`)} />
        </View>
      ))}

      {/* Piciorul de paginare: buton/spinner/eroare, fără să șteargă paginile aduse. */}
      {hasNextPage || isFetchNextPageError ? (
        <View style={{ paddingVertical: spacing.sm, gap: spacing.sm }}>
          {isFetchingNextPage ? (
            <ActivityIndicator color={colors.accent} testID="received-loading-more" />
          ) : (
            <>
              {isFetchNextPageError ? (
                <Text
                  testID="received-load-more-error"
                  style={[typography.caption, styles.center, { color: colors.danger }]}
                >
                  {t('loadMoreError')}
                </Text>
              ) : null}
              <Button
                label={isFetchNextPageError ? t('retry') : t('loadMore')}
                variant="outline"
                onPress={() => fetchNextPage()}
                testID="received-load-more"
              />
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  info: { flex: 1, gap: 4 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flexShrink: 1 },
  superBadge: { paddingHorizontal: 8, paddingVertical: 2 },
  avatar: { width: 44, height: 44 },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
});
