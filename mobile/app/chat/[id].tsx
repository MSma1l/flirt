/** Conversație (TZ secț. 5): mesaje cu poll ~3s, trimitere, marcare citit la intrare. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchChats, fetchMessages, markRead, sendMessage } from '@/features/chat/chatApi';
import { MessageBubble } from '@/features/chat/MessageBubble';
import { ChatMessage, ChatSummary } from '@/features/chat/types';
import { useAuthStore } from '@/store/authStore';
import { useTheme } from '@theme/index';

const REFETCH_MS = 3000;

export default function ChatScreen() {
  const { colors, typography, spacing, radius } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const chatId = Array.isArray(id) ? id[0] : id;
  const currentUserId = useAuthStore((s) => s.user?.id ?? '');

  const [draft, setDraft] = useState('');

  const { data, isLoading, isError } = useQuery<ChatMessage[]>({
    queryKey: ['messages', chatId],
    queryFn: () => fetchMessages(chatId),
    enabled: !!chatId,
    refetchInterval: REFETCH_MS,
  });

  // Numele celuilalt din lista de dialoguri (cache partajat).
  const chats = queryClient.getQueryData<ChatSummary[]>(['chats']);
  const summary = chats?.find((c) => c.chatId === chatId);
  const headerName = summary?.otherName ?? 'Conversație';

  // Marchează dialogul ca citit la deschidere.
  useEffect(() => {
    if (!chatId) return;
    markRead(chatId)
      .then(() => queryClient.invalidateQueries({ queryKey: ['chats'] }))
      .catch(() => {
        /* eșecul marcării nu blochează conversația */
      });
  }, [chatId, queryClient]);

  const sendMutation = useMutation({
    mutationFn: (body: string) => sendMessage(chatId, body),
    onSuccess: () => {
      setDraft('');
      queryClient.invalidateQueries({ queryKey: ['messages', chatId] });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });

  // FlatList inversat: cel mai nou mesaj primul.
  const messages = data ?? [];
  const inverted = useMemo(() => [...messages].reverse(), [messages]);

  const trimmed = draft.trim();
  const canSend = trimmed.length > 0 && !sendMutation.isPending;

  const handleSend = () => {
    if (!canSend) return;
    sendMutation.mutate(trimmed);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header cu numele celuilalt */}
      <View
        style={[
          styles.header,
          { borderBottomColor: colors.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Înapoi"
          onPress={() => router.back()}
          hitSlop={8}
        >
          <Text style={[typography.h2, { color: colors.accent }]}>‹</Text>
        </Pressable>
        <Text
          numberOfLines={1}
          style={[typography.h2, styles.headerTitle, { color: colors.textPrimary }]}
        >
          {headerName}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.flex}>
          {isLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : isError ? (
            <View style={styles.center}>
              <Text style={[typography.body, { color: colors.danger }]}>
                Nu am putut încărca mesajele.
              </Text>
            </View>
          ) : messages.length === 0 ? (
            <View style={styles.center}>
              <Text style={[typography.body, { color: colors.textSecondary }]}>
                Scrie primul mesaj 👋
              </Text>
            </View>
          ) : (
            <FlatList
              data={inverted}
              inverted
              keyExtractor={(m) => m.id}
              contentContainerStyle={{ padding: spacing.lg }}
              renderItem={({ item }) => (
                <MessageBubble message={item} currentUserId={currentUserId} />
              )}
            />
          )}
        </View>

        <View
          style={[
            styles.composer,
            {
              backgroundColor: colors.surface,
              borderTopColor: colors.border,
              padding: spacing.md,
              gap: spacing.sm,
            },
          ]}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Scrie un mesaj…"
            placeholderTextColor={colors.textDisabled}
            multiline
            style={[
              typography.body,
              styles.input,
              {
                backgroundColor: colors.bg,
                borderColor: colors.border,
                borderRadius: radius.md,
                color: colors.textPrimary,
              },
            ]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Trimite"
            disabled={!canSend}
            onPress={handleSend}
            style={({ pressed }) => [
              styles.sendBtn,
              {
                backgroundColor: canSend
                  ? pressed
                    ? colors.accentPressed
                    : colors.accent
                  : colors.accentDisabled,
                borderRadius: radius.pill,
              },
            ]}
          >
            {sendMutation.isPending ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={[typography.bodyStrong, { color: colors.onAccent }]}>Trimite</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxHeight: 120,
  },
  sendBtn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
