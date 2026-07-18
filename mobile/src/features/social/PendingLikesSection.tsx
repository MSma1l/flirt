/**
 * Secțiunea „În așteptare" din ecranul Mesaje.
 *
 * Arată persoanele cărora utilizatorul le-a dat like/super like și care încă
 * NU au răspuns — deci NU e încă match. E o zonă deliberat separată de
 * conversațiile reale: aici nu poți scrie și nu poți intra într-un chat, doar
 * aștepți răspuns. Când celălalt dă like înapoi → devine match → iese de aici
 * și apare în lista normală de chat-uri.
 *
 * Starea „în așteptare" e vizibilă DOAR pentru tine. Mesajul pe care l-ai scris
 * la like rămâne ascuns de celălalt până la match, dar TU ți-l vezi aici
 * („Ai scris: ...").
 *
 * DECIZIE — secțiune ascunsă când e goală: componenta întoarce `null` dacă nu
 * ai like-uri în așteptare, ca să nu ocupe spațiu mort deasupra chat-urilor
 * reale. Textul de gol („Nu ai like-uri în așteptare") apare doar când ecranul
 * ar fi altfel complet gol (`showEmpty`), ca userul fără niciun chat să înțeleagă
 * ce e zona asta — nu ca zgomot deasupra unei liste populate.
 *
 * Cardurile sunt `View`-uri simple (fără `Pressable`): nu duc nicăieri (nu
 * există încă un chat), iar pe web asta evită și un buton imbricat în lista-mamă.
 */
import { useInfiniteQuery } from '@tanstack/react-query';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { PendingLikeItem, fetchPendingLikesPage } from '@/features/social/socialApi';
import { useTheme } from '@theme/index';

/** Avatarul din rând: prima poză a profilului sau inițiala numelui. */
function Avatar({ item }: { item: PendingLikeItem }) {
  const { colors, typography, radius } = useTheme();
  const photo = item.photos[0];
  const initial = item.name.trim().charAt(0).toUpperCase() || '?';

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

/** Un rând din „În așteptare": poză, nume+vârstă, badge super, mesajul tău. */
function PendingRow({ item }: { item: PendingLikeItem }) {
  const { colors, typography, spacing, radius } = useTheme();
  const { t } = useTranslation('chat');
  return (
    <View
      testID={`pending-${item.targetUserId}`}
      style={[
        styles.row,
        {
          backgroundColor: colors.surface,
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
            {item.name}, {item.age}
          </Text>
          {item.isSuper ? (
            <View
              testID={`pending-super-${item.targetUserId}`}
              accessibilityLabel="Super like"
              style={[styles.superBadge, { backgroundColor: colors.tagBg, borderRadius: radius.pill }]}
            >
              <Text style={[typography.badge, { color: colors.accent }]}>{t('pending.super')}</Text>
            </View>
          ) : null}
        </View>

        {item.city ? (
          <Text style={[typography.caption, { color: colors.textSecondary }]}>{item.city}</Text>
        ) : null}

        {item.myMessage ? (
          <Text
            numberOfLines={2}
            style={[typography.caption, { color: colors.textSecondary, fontStyle: 'italic' }]}
          >
            {t('pending.youWrote', { message: item.myMessage })}
          </Text>
        ) : null}

        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {t('pending.waiting')}
        </Text>
      </View>
    </View>
  );
}

export function PendingLikesSection({ showEmpty = false }: { showEmpty?: boolean }) {
  const { colors, typography, spacing } = useTheme();
  const { t } = useTranslation('chat');

  // Paginat pe cursor (`X-Next-Cursor`), la fel ca favorite/blocați:
  // `useInfiniteQuery` ține paginile în cache și le concatenează singur.
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
    queryKey: ['likes', 'pending'],
    queryFn: ({ pageParam }) => fetchPendingLikesPage({ cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  // Loading DISTINCT de gol: cât timp aducem prima pagină nu știm dacă e goală,
  // deci arătăm un spinner, nu textul „nu ai like-uri în așteptare".
  if (isLoading) {
    return (
      <View style={[styles.section, { paddingVertical: spacing.md }]}>
        <ActivityIndicator color={colors.accent} testID="pending-loading" />
      </View>
    );
  }

  // Eroare DOAR când n-avem nimic de arătat. Dacă pagina 1 e deja pe ecran și
  // pică pagina 2, lista rămâne, iar eroarea apare în piciorul secțiunii.
  if (isError && data === undefined) {
    return (
      <View style={[styles.section, { gap: spacing.sm }]}>
        <Text style={[typography.h2, { color: colors.textPrimary }]}>{t('pending.title')}</Text>
        <Text style={[typography.caption, { color: colors.danger }]} testID="pending-error">
          {t('pending.loadError')}
        </Text>
        <Button
          label={t('retry')}
          variant="outline"
          onPress={() => refetch()}
          testID="pending-retry"
        />
      </View>
    );
  }

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  if (items.length === 0) {
    // Ascunsă când e goală ca să nu lase spațiu mort deasupra chat-urilor.
    // Excepția: ecranul altfel complet gol — atunci explicăm ce e zona asta.
    if (!showEmpty) return null;
    return (
      <View style={[styles.section, { gap: spacing.xs }]}>
        <Text style={[typography.h2, { color: colors.textPrimary }]}>{t('pending.title')}</Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]} testID="pending-empty">
          {t('pending.empty')}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.section, { gap: spacing.sm }]}>
      <Text style={[typography.h2, { color: colors.textPrimary }]}>{t('pending.title')}</Text>
      <Text style={[typography.caption, { color: colors.textSecondary, marginBottom: spacing.xs }]}>
        {t('pending.hint')}
      </Text>

      {items.map((item) => (
        <View key={item.targetUserId} style={{ marginBottom: spacing.sm }}>
          <PendingRow item={item} />
        </View>
      ))}

      {/* Piciorul de paginare: buton/spinner/eroare. O eroare la pagina 2 NU
          șterge paginile deja aduse — apare aici, sub rânduri. */}
      {hasNextPage || isFetchNextPageError ? (
        <View style={{ paddingVertical: spacing.sm, gap: spacing.sm }}>
          {isFetchingNextPage ? (
            <ActivityIndicator color={colors.accent} testID="pending-loading-more" />
          ) : (
            <>
              {isFetchNextPageError ? (
                <Text
                  testID="pending-load-more-error"
                  style={[typography.caption, styles.center, { color: colors.danger }]}
                >
                  {t('loadMoreError')}
                </Text>
              ) : null}
              <Button
                label={isFetchNextPageError ? t('retry') : t('loadMore')}
                variant="outline"
                onPress={() => fetchNextPage()}
                testID="pending-load-more"
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
