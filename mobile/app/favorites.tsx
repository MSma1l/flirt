/**
 * Ecranul „Favorite" (TZ secț. 6.1).
 *
 * Afișează DOUĂ liste, în secțiuni separate și etichetate:
 *   1. „Le-ai dat like" — profilurile apreciate cu swipe dreapta în deck
 *      (automat, din `/social/likes/sent`);
 *   2. „Favorite ★" — profilurile marcate manual cu ★ (`/social/favorites`).
 *
 * DE CE SECȚIUNI ȘI NU UN TOGGLE: cele două liste au sensuri diferite (una e
 * istoricul swipe-urilor, alta e o colecție intenționată), iar un toggle ar
 * ascunde-o pe una din ele — userul cu zero favorite ar vedea tot un ecran gol
 * și n-ar afla că ★ există. Într-o singură listă derulabilă vede ambele
 * deodată, cu antetul care explică de ce apare fiecare persoană acolo.
 */
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button, ScreenContainer } from '@/components/ui';
import {
  FavoriteItem,
  fetchFavoritesPage,
  fetchLikesSentPage,
  removeFavorite,
} from '@/features/social/socialApi';
import { useFavorite } from '@/features/social/useFavorite';
import { alertMessage } from '@/utils/dialog';
import { useTheme } from '@theme/index';

/** Avatarul din rând: prima poză a profilului sau inițiala numelui. */
function Avatar({ item }: { item: FavoriteItem }) {
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

/** Rând din „Favorite ★": nume, vârstă, oraș + buton de eliminare. */
function FavoriteRow({
  item,
  onRemove,
  removing,
}: {
  item: FavoriteItem;
  onRemove: () => void;
  removing: boolean;
}) {
  const { colors, typography, spacing, radius } = useTheme();
  return (
    <View
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
        <Text style={[typography.bodyStrong, { color: colors.textPrimary }]}>
          {item.name}, {item.age}
        </Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>{item.city}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Elimină ${item.name} din favorite`}
        disabled={removing}
        onPress={onRemove}
        hitSlop={spacing.sm}
        testID={`favorite-remove-${item.targetUserId}`}
      >
        {removing ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <Text style={[styles.actionIcon, { color: colors.accent }]}>♥</Text>
        )}
      </Pressable>
    </View>
  );
}

/**
 * Rând din „Le-ai dat like": aceleași date + ★ ca să treacă profilul și în
 * favorite. Steaua plină (buton dezactivat) = e deja acolo.
 */
function LikeSentRow({ item }: { item: FavoriteItem }) {
  const { colors, typography, spacing, radius } = useTheme();
  const { isFavorite, markFavorite, isAdding } = useFavorite(item.targetUserId);

  return (
    <View
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
        <Text style={[typography.bodyStrong, { color: colors.textPrimary }]}>
          {item.name}, {item.age}
        </Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>{item.city}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          isFavorite ? `${item.name} e deja la favorite` : `Adaugă ${item.name} la favorite`
        }
        accessibilityState={{ selected: isFavorite, disabled: isFavorite || isAdding }}
        disabled={isFavorite || isAdding}
        onPress={markFavorite}
        hitSlop={spacing.sm}
        testID={`like-favorite-${item.targetUserId}`}
      >
        {isAdding ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <Text style={[styles.actionIcon, { color: colors.accent }]}>
            {isFavorite ? '★' : '☆'}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

/** O secțiune din ecran: titlu, explicație, rândurile ei și starea paginării. */
interface Section {
  key: 'likes' | 'favorites';
  title: string;
  hint: string;
  data: FavoriteItem[];
  /** Backendul a trimis `X-Next-Cursor` → mai există cel puțin o pagină. */
  hasMore: boolean;
  /** Pagina următoare e în curs de aducere. */
  loadingMore: boolean;
  /** Ultima încercare de „încarcă mai multe" a picat (paginile deja aduse RĂMÂN). */
  failedMore: boolean;
  loadMore: () => void;
}

/**
 * Piciorul unei secțiuni: „Încarcă mai multe" / spinner / eroare de paginare.
 *
 * O eroare la pagina 2 NU are voie să șteargă pagina 1 de pe ecran, deci se
 * afișează aici, sub rândurile deja încărcate, nu ca ecran de eroare.
 */
function SectionFooter({ section }: { section: Section }) {
  const { colors, typography, spacing } = useTheme();

  if (!section.hasMore && !section.failedMore) return null;

  if (section.loadingMore) {
    return (
      <View style={{ paddingVertical: spacing.md }}>
        <ActivityIndicator color={colors.accent} testID={`${section.key}-loading-more`} />
      </View>
    );
  }

  return (
    <View style={{ paddingVertical: spacing.md, gap: spacing.sm }}>
      {section.failedMore && (
        <Text
          testID={`${section.key}-load-more-error`}
          style={[typography.caption, styles.center, { color: colors.danger }]}
        >
          Nu am putut încărca mai multe.
        </Text>
      )}
      <Button
        label={section.failedMore ? 'Reîncearcă' : 'Încarcă mai multe'}
        variant="outline"
        onPress={section.loadMore}
        testID={`${section.key}-load-more`}
      />
    </View>
  );
}

export default function FavoritesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors, typography, spacing } = useTheme();

  // Ambele liste sunt paginate pe cursor de backend (`X-Next-Cursor`), deci
  // `useInfiniteQuery`: el ține paginile în cache și le concatenează singur, în
  // loc să reinventăm acumularea lor în `useState` (unde un refetch după
  // ștergerea unui favorit ar readuce doar prima pagină peste restul).
  //
  // Sufixul 'infinite' din cheie: `useFavorite` ține pe cheia ['favorites'] o
  // listă SIMPLĂ (prima pagină), iar două forme diferite de date pe aceeași
  // cheie s-ar suprascrie reciproc în cache. Invalidarea pe ['favorites']
  // ajunge oricum și aici — React Query potrivește cheile pe prefix.
  const favoritesQuery = useInfiniteQuery({
    queryKey: ['favorites', 'infinite'],
    queryFn: ({ pageParam }) => fetchFavoritesPage({ cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const likesQuery = useInfiniteQuery({
    queryKey: ['likesSent', 'infinite'],
    queryFn: ({ pageParam }) => fetchLikesSentPage({ cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const mutation = useMutation({
    mutationFn: (targetUserId: string) => removeFavorite(targetUserId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['favorites'] }),
    onError: () => alertMessage('Ceva n-a mers', 'Nu am putut elimina din favorite. Reîncearcă.'),
  });

  // Loading și eroare se tratează ÎNAINTEA ramurii de gol: un ecran care încă
  // încarcă (sau care a picat) NU are voie să spună „nu ai favorite".
  if (favoritesQuery.isLoading || likesQuery.isLoading) {
    return (
      <ScreenContainer center>
        <ActivityIndicator color={colors.accent} testID="favorites-loading" />
      </ScreenContainer>
    );
  }

  // Ecranul de eroare e DOAR pentru „n-avem nimic de arătat": o listă care a
  // adus pagina 1 și a picat la pagina 2 rămâne pe ecran, cu eroarea în piciorul
  // secțiunii ei (vezi `SectionFooter`).
  const favoritesFailed = favoritesQuery.isError && favoritesQuery.data === undefined;
  const likesFailed = likesQuery.isError && likesQuery.data === undefined;

  if (favoritesFailed || likesFailed) {
    return (
      <ScreenContainer center>
        <Text
          style={[
            typography.body,
            styles.center,
            { color: colors.textSecondary, marginBottom: spacing.lg },
          ]}
        >
          Nu am putut încărca lista.
        </Text>
        <Button
          label="Reîncearcă"
          variant="outline"
          onPress={() => {
            favoritesQuery.refetch();
            likesQuery.refetch();
          }}
        />
      </ScreenContainer>
    );
  }

  // Paginile aduse până acum, aplatizate într-o singură listă per secțiune.
  const favorites = favoritesQuery.data?.pages.flatMap((p) => p.items) ?? [];
  const likes = likesQuery.data?.pages.flatMap((p) => p.items) ?? [];

  // Secțiunile goale nu se randează: un antet cu zero rânduri sub el e zgomot.
  // Când AMBELE sunt goale, mai jos se afișează un empty state care le explică.
  const allSections: Section[] = [
    {
      key: 'likes',
      title: 'Le-ai dat like',
      hint: 'Profilurile pe care le-ai apreciat cu swipe dreapta.',
      data: likes,
      hasMore: likesQuery.hasNextPage,
      loadingMore: likesQuery.isFetchingNextPage,
      failedMore: likesQuery.isFetchNextPageError,
      loadMore: () => likesQuery.fetchNextPage(),
    },
    {
      key: 'favorites',
      title: 'Favorite ★',
      hint: 'Profilurile pe care le-ai marcat manual cu ★.',
      data: favorites,
      hasMore: favoritesQuery.hasNextPage,
      loadingMore: favoritesQuery.isFetchingNextPage,
      failedMore: favoritesQuery.isFetchNextPageError,
      loadMore: () => favoritesQuery.fetchNextPage(),
    },
  ];
  const sections = allSections.filter((section) => section.data.length > 0);

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Înapoi"
          onPress={() => router.back()}
          hitSlop={spacing.sm}
        >
          <Text style={[typography.h2, { color: colors.accent }]}>‹</Text>
        </Pressable>
        <Text style={[typography.h1, { color: colors.textPrimary }]}>Favorite</Text>
      </View>

      {sections.length === 0 ? (
        <View style={styles.empty} testID="favorites-empty">
          <Text style={[typography.body, styles.center, { color: colors.textSecondary }]}>
            Încă n-ai dat like nimănui și n-ai marcat pe nimeni cu ★.
          </Text>
          <Text
            style={[
              typography.caption,
              styles.center,
              { color: colors.textSecondary, marginTop: spacing.sm },
            ]}
          >
            Profilurile apreciate în deck apar aici automat.
          </Text>
        </View>
      ) : (
        <SectionList
          style={{ flex: 1, marginTop: spacing.lg }}
          sections={sections}
          keyExtractor={(item) => item.targetUserId}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}
          renderSectionHeader={({ section }) => (
            <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
              <Text style={[typography.h2, { color: colors.textPrimary }]}>{section.title}</Text>
              <Text style={[typography.caption, { color: colors.textSecondary }]}>
                {section.hint}
              </Text>
            </View>
          )}
          renderSectionFooter={({ section }) => <SectionFooter section={section} />}
          renderItem={({ item, section }) =>
            section.key === 'favorites' ? (
              <FavoriteRow
                item={item}
                removing={mutation.isPending && mutation.variables === item.targetUserId}
                onRemove={() => mutation.mutate(item.targetUserId)}
              />
            ) : (
              <LikeSentRow item={item} />
            )
          }
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
  },
  info: { gap: 4, flex: 1 },
  avatar: { width: 44, height: 44 },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  actionIcon: { fontSize: 24, lineHeight: 28 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
});
