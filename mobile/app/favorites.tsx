/** Ecranul de favorite (TZ secț. 6.1): listă + eliminare din favorite. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, ScreenContainer } from '@/components/ui';
import { FavoriteItem, fetchFavorites, removeFavorite } from '@/features/social/socialApi';
import { useTheme } from '@theme/index';

/** Un rând din lista de favorite: nume, vârstă, oraș + buton de eliminare. */
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
        },
      ]}
    >
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
      >
        {removing ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <Text style={[styles.removeIcon, { color: colors.accent }]}>♥</Text>
        )}
      </Pressable>
    </View>
  );
}

export default function FavoritesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors, typography, spacing } = useTheme();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['favorites'],
    queryFn: fetchFavorites,
  });

  const mutation = useMutation({
    mutationFn: (targetUserId: string) => removeFavorite(targetUserId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['favorites'] }),
    onError: () => Alert.alert('Ceva n-a mers', 'Nu am putut elimina din favorite. Reîncearcă.'),
  });

  if (isLoading) {
    return (
      <ScreenContainer center>
        <ActivityIndicator color={colors.accent} />
      </ScreenContainer>
    );
  }

  if (isError) {
    return (
      <ScreenContainer center>
        <Text
          style={[
            typography.body,
            styles.center,
            { color: colors.textSecondary, marginBottom: spacing.lg },
          ]}
        >
          Nu am putut încărca favoritele.
        </Text>
        <Button label="Reîncearcă" variant="outline" onPress={() => refetch()} />
      </ScreenContainer>
    );
  }

  const favorites = data ?? [];

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

      {favorites.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[typography.body, styles.center, { color: colors.textSecondary }]}>
            Nu ai favorite încă ★
          </Text>
        </View>
      ) : (
        <FlatList
          style={{ flex: 1, marginTop: spacing.lg }}
          data={favorites}
          keyExtractor={(item) => item.targetUserId}
          contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}
          renderItem={({ item }) => (
            <FavoriteRow
              item={item}
              removing={mutation.isPending && mutation.variables === item.targetUserId}
              onRemove={() => mutation.mutate(item.targetUserId)}
            />
          )}
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
  removeIcon: { fontSize: 24, lineHeight: 28 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
});
