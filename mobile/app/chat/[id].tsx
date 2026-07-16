/** Conversație (TZ secț. 5): mesaje cu poll ~3s, trimitere, marcare citit la intrare. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
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

import { Button } from '@/components/ui';
import { fetchChats, fetchMessages, markRead, reactToMessage, sendMessage } from '@/features/chat/chatApi';
import { MessageBubble } from '@/features/chat/MessageBubble';
import { ChatMessage, ChatSummary } from '@/features/chat/types';
import { CompatBadge } from '@/features/feed/CompatBadge';
import { ReportModal } from '@/features/moderation/ReportModal';
import { useBlockUser } from '@/features/social/useBlockUser';
import { useAuthStore } from '@/store/authStore';
import { firstError, LIMITS, maxLen, noHtml } from '@/utils/validation';
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
  const [reportOpen, setReportOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<ChatMessage[]>({
    queryKey: ['messages', chatId],
    queryFn: () => fetchMessages(chatId),
    enabled: !!chatId,
    refetchInterval: REFETCH_MS,
  });

  // Numele celuilalt din lista de dialoguri. Backendul NU expune un endpoint
  // pentru un chat singular (`backend/app/api/v1/chat.py` are doar `GET /chats/`),
  // deci folosim aceeași cheie `['chats']` ca ecranul Mesaje: când tab-urile sunt
  // montate datele vin instant din cache-ul partajat, iar la cold-start dintr-o
  // notificare (cache gol, tab-uri nemontate) React Query le aduce singur —
  // altfel headerul rămânea „Conversație", fără badge și cu Blochează/Raportează
  // dezactivate (App Store Guideline 1.2).
  const { data: chats } = useQuery<ChatSummary[]>({
    queryKey: ['chats'],
    queryFn: fetchChats,
  });
  const summary = chats?.find((c) => c.chatId === chatId);
  const headerName = summary?.otherName ?? 'Conversație';
  const compatibility = summary?.compatibility;

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

  const reactMutation = useMutation({
    mutationFn: (vars: { messageId: string; reaction: string | null }) =>
      reactToMessage(chatId, vars.messageId, vars.reaction),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', chatId] });
    },
  });

  // FlatList inversat: cel mai nou mesaj primul.
  const messages = data ?? [];
  const inverted = useMemo(() => [...messages].reverse(), [messages]);

  // Prop-ul `inverted` al lui FlatList e RUPT pe react-native-web (folosește
  // `transform: scaleY(-1)` și adesea nu randează itemele) — mesajele nu se
  // vedeau deloc în browser. Pe web randăm o listă NORMALĂ, sortată cronologic
  // (cel mai vechi sus, cel mai nou jos) și derulăm la ultimul mesaj. Pe nativ
  // rămâne exact ca înainte (inverted).
  const isWeb = Platform.OS === 'web';
  const chronological = useMemo(
    () => [...messages].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    [messages],
  );
  const listRef = useRef<FlatList<ChatMessage>>(null);

  // Celălalt participant: primul senderId diferit de utilizatorul curent
  // (fallback pe datele din lista de dialoguri).
  const reportedUserId = useMemo(
    () =>
      messages.find((m: ChatMessage) => m.senderId !== currentUserId)?.senderId ??
      summary?.otherUserId ??
      '',
    [messages, currentUserId, summary?.otherUserId],
  );

  // Blocare (Guideline 1.2): după blocare ieșim din conversație.
  const { confirmBlock, isBlocking } = useBlockUser({ onBlocked: () => router.back() });

  const trimmed = draft.trim();
  // Non-gol + ≤2000 + fără marcaje HTML (simetric cu backend-ul).
  const messageError =
    trimmed.length > 0
      ? firstError(maxLen(trimmed, LIMITS.message), noHtml(trimmed))
      : null;
  const canSend =
    trimmed.length > 0 && !messageError && !sendMutation.isPending;

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
        {typeof compatibility === 'number' ? <CompatBadge score={compatibility} /> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Raportează"
          onPress={() => setReportOpen(true)}
          disabled={!reportedUserId}
          hitSlop={8}
          testID="chat-report"
        >
          <Text style={[typography.h2, { color: colors.warning }]}>⚠</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Blochează"
          onPress={() => confirmBlock(reportedUserId, summary?.otherName)}
          disabled={!reportedUserId || isBlocking}
          hitSlop={8}
          testID="chat-block"
        >
          <Text style={[typography.h2, { color: colors.danger }]}>🚫</Text>
        </Pressable>
      </View>

      {reportOpen ? (
        <ReportModal
          visible={reportOpen}
          reportedUserId={reportedUserId}
          chatId={chatId}
          onClose={() => setReportOpen(false)}
        />
      ) : null}

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
              <Text
                style={[typography.body, { color: colors.danger, marginBottom: spacing.lg }]}
              >
                Nu am putut încărca mesajele.
              </Text>
              <Button label="Reîncearcă" variant="outline" onPress={() => refetch()} />
            </View>
          ) : messages.length === 0 ? (
            <View style={styles.center}>
              <Text style={[typography.body, { color: colors.textSecondary }]}>
                Scrie primul mesaj 👋
              </Text>
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={isWeb ? chronological : inverted}
              inverted={!isWeb}
              onContentSizeChange={
                isWeb ? () => listRef.current?.scrollToEnd({ animated: false }) : undefined
              }
              keyExtractor={(m) => m.id}
              contentContainerStyle={{ padding: spacing.lg }}
              renderItem={({ item }) => (
                <MessageBubble
                  message={item}
                  currentUserId={currentUserId}
                  onReact={(reaction) => reactMutation.mutate({ messageId: item.id, reaction })}
                />
              )}
            />
          )}
        </View>

        {messageError ? (
          <Text
            testID="message-error"
            style={[
              typography.caption,
              {
                color: colors.danger,
                backgroundColor: colors.surface,
                paddingHorizontal: spacing.md,
                paddingTop: spacing.xs,
              },
            ]}
          >
            {messageError}
          </Text>
        ) : sendMutation.isError ? (
          <Text
            style={[
              typography.caption,
              {
                color: colors.danger,
                backgroundColor: colors.surface,
                paddingHorizontal: spacing.md,
                paddingTop: spacing.xs,
              },
            ]}
          >
            Mesajul nu a fost trimis. Reîncearcă.
          </Text>
        ) : null}

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
            maxLength={LIMITS.message}
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
