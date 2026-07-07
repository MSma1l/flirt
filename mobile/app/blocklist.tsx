/** Utilizatori blocați (TZ secț. 6.2): listă + deblocare. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, ScreenContainer } from '@/components/ui';
import { BlockedUser, fetchBlocks, unblock } from '@/features/settings/settingsApi';
import { useTheme } from '@theme/index';

export default function BlocklistScreen() {
  const { colors, typography, spacing, radius } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery<BlockedUser[]>({
    queryKey: ['blocks'],
    queryFn: fetchBlocks,
  });

  const unblockMutation = useMutation({
    mutationFn: (blockedId: string) => unblock(blockedId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['blocks'] }),
    onError: () => Alert.alert('Ceva n-a mers', 'Nu am putut debloca utilizatorul. Reîncearcă.'),
  });

  if (isLoading) {
    return (
      <ScreenContainer center>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={colors.accent} />
      </ScreenContainer>
    );
  }

  if (isError) {
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

  const blocks = data ?? [];

  return (
    <ScreenContainer>
      <Stack.Screen options={{ headerShown: false }} />

      <Pressable
        accessibilityRole="button"
        onPress={() => router.back()}
        style={{ marginBottom: spacing.lg }}
      >
        <Text style={[typography.bodyStrong, { color: colors.accent }]}>‹ Înapoi</Text>
      </Pressable>

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
