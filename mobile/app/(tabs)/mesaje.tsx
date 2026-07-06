/** Mesaje — lista de dialoguri (TZ secț. 5). Poll la ~5s, tap → conversație. */
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '@/components/ui';
import { ChatListItem } from '@/features/chat/ChatListItem';
import { fetchChats } from '@/features/chat/chatApi';
import { ChatSummary } from '@/features/chat/types';
import { useTheme } from '@theme/index';

const REFETCH_MS = 5000;

export default function MesajeScreen() {
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();

  const { data, isLoading, isError, refetch } = useQuery<ChatSummary[]>({
    queryKey: ['chats'],
    queryFn: fetchChats,
    refetchInterval: REFETCH_MS,
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
        <Text style={[typography.body, styles.center, { color: colors.danger }]}>
          Nu am putut încărca mesajele.
        </Text>
        <Text
          accessibilityRole="button"
          onPress={() => refetch()}
          style={[typography.bodyStrong, styles.center, { color: colors.accent, marginTop: spacing.md }]}
        >
          Reîncearcă
        </Text>
      </ScreenContainer>
    );
  }

  const chats = data ?? [];

  if (chats.length === 0) {
    return (
      <ScreenContainer center>
        <Text style={[typography.body, styles.center, { color: colors.textSecondary }]}>
          Mesajele apar aici după un match 💬
        </Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Text style={[typography.h1, { color: colors.textPrimary, marginBottom: spacing.lg }]}>
        Mesaje
      </Text>
      <FlatList
        data={chats}
        keyExtractor={(c) => c.chatId}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        renderItem={({ item }) => (
          <ChatListItem
            chat={item}
            onPress={() => router.push(`/chat/${item.chatId}`)}
          />
        )}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  center: {
    textAlign: 'center',
  },
});
