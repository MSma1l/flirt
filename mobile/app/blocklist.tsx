/** Utilizatori blocați (TZ secț. 6.2): listă paginată pe cursor + deblocare. */
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import React from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import { BackButton, Button, ScreenContainer } from '@/components/ui';
import { fetchBlocks, unblock } from '@/features/settings/settingsApi';
import { alertMessage } from '@/utils/dialog';
import { useTheme } from '@theme/index';

export default function BlocklistScreen() {
  const { colors, typography, spacing, radius } = useTheme();
  const queryClient = useQueryClient();

  // Backendul paginează pe cursor (`X-Next-Cursor`), deci `useInfiniteQuery`:
  // el acumulează paginile în cache, fără stare locală care s-ar pierde la
  // refetch-ul de după deblocare.
  //
  // Sufixul 'infinite' din cheie ține cache-ul paginat separat de eventualii
  // consumatori ai unei liste simple pe ['blocks']; invalidarea pe ['blocks']
  // (vezi `useBlockUser`) ajunge oricum aici — cheile se potrivesc pe prefix.
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
    queryKey: ['blocks', 'infinite'],
    queryFn: ({ pageParam }) => fetchBlocks({ cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const unblockMutation = useMutation({
    mutationFn: (blockedId: string) => unblock(blockedId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['blocks'] }),
    onError: () => alertMessage('Ceva n-a mers', 'Nu am putut debloca utilizatorul. Reîncearcă.'),
  });

  if (isLoading) {
    return (
      <ScreenContainer center>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={colors.accent} />
      </ScreenContainer>
    );
  }

  // Ecran de eroare DOAR când n-avem nimic de arătat. Dacă pagina 1 e deja pe
  // ecran și pică pagina 2, lista rămâne, iar eroarea apare în piciorul ei.
  if (isError && data === undefined) {
    return (
      <ScreenContainer center>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={[typography.body, styles.center, { color: colors.danger }]}>
          Nu am putut încărca lista.
        </Text>
        <Text
          accessibilityRole="button"
          onPress={() => refetch()}
          style={[
            typography.bodyStrong,
            styles.center,
            { color: colors.accent, marginTop: spacing.md },
          ]}
        >
          Reîncearcă
        </Text>
      </ScreenContainer>
    );
  }

  // Paginile aduse până acum, aplatizate într-o singură listă.
  const blocks = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <ScreenContainer>
      <Stack.Screen options={{ headerShown: false }} />

      <BackButton style={{ alignSelf: 'flex-start', marginBottom: spacing.lg }} />

      <Text style={[typography.h1, { color: colors.textPrimary, marginBottom: spacing.lg }]}>
        Utilizatori blocați
      </Text>

      {blocks.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[typography.body, styles.center, { color: colors.textSecondary }]}>
            Nu ai utilizatori blocați.
          </Text>
        </View>
      ) : (
        <FlatList
          data={blocks}
          keyExtractor={(b) => b.blockedId}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          // Infinite scroll + buton: derularea aduce pagina următoare singură,
          // iar butonul rămâne pentru cine nu ajunge la capătul listei.
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) fetchNextPage();
          }}
          ListFooterComponent={
            hasNextPage || isFetchNextPageError ? (
              <View style={{ paddingVertical: spacing.lg, gap: spacing.sm }}>
                {isFetchingNextPage ? (
                  <ActivityIndicator color={colors.accent} testID="blocks-loading-more" />
                ) : (
                  <>
                    {isFetchNextPageError && (
                      <Text
                        testID="blocks-load-more-error"
                        style={[typography.caption, styles.center, { color: colors.danger }]}
                      >
                        Nu am putut încărca mai multe.
                      </Text>
                    )}
                    <Button
                      label={isFetchNextPageError ? 'Reîncearcă' : 'Încarcă mai multe'}
                      variant="outline"
                      onPress={() => fetchNextPage()}
                      testID="blocks-load-more"
                    />
                  </>
                )}
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <View
              testID={`block-${item.blockedId}`}
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
              <Text
                numberOfLines={1}
                style={[typography.bodyStrong, styles.name, { color: colors.textPrimary }]}
              >
                {item.name}
              </Text>
              <Button
                label="Deblochează"
                variant="outline"
                loading={
                  unblockMutation.isPending &&
                  unblockMutation.variables === item.blockedId
                }
                onPress={() => unblockMutation.mutate(item.blockedId)}
                testID={`unblock-${item.blockedId}`}
                style={styles.btn}
              />
            </View>
          )}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  name: { flex: 1 },
  btn: { paddingVertical: 10, paddingHorizontal: 16 },
});
