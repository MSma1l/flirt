/**
 * Mesaje (TZ secț. 5) — organizat pe SECȚIUNI clare, nu o listă amestecată:
 *
 *   1. „În așteptare"  — like-uri trimise fără match încă (`PendingLikesSection`,
 *      din `/social/likes/pending`). Aici NU poți scrie; aștepți răspuns.
 *   2. „Match nou"     — match-uri cu mesaje NEcitite sau proaspete fără niciun
 *      mesaj încă. Sus, ca să sară în ochi. Aici POȚI scrie.
 *   3. „Conversații"   — restul chat-urilor active (citite).
 *
 * Diferența de tap e intenționată: cardurile „în așteptare" NU deschid un chat
 * (nu există încă), pe când un card de match deschide conversația.
 *
 * Gruparea folosește DOAR câmpuri care există în `ChatSummary`: `unreadCount`
 * (necitite) și `lastMessage` (lipsă = match proaspăt fără mesaj). Nu inventăm
 * câmpuri noi.
 *
 * Secțiunile goale nu se randează — un antet fără rânduri sub el e spațiu mort.
 */
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, SectionList, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '@/components/ui';
import { ChatListItem } from '@/features/chat/ChatListItem';
import { fetchChats } from '@/features/chat/chatApi';
import { ChatSummary } from '@/features/chat/types';
import { usePushPermissionPrompt } from '@/features/push/usePushPermissionPrompt';
import { PendingLikesSection } from '@/features/social/PendingLikesSection';
import { useTheme } from '@theme/index';

const REFETCH_MS = 5000;

/** O secțiune de chat-uri reale (match-uri): titlu, explicație, rândurile ei. */
interface ChatSection {
  key: 'new' | 'active';
  title: string;
  hint?: string;
  data: ChatSummary[];
}

/**
 * Un match e „nou / necitit" dacă are mesaje necitite SAU e proaspăt fără niciun
 * mesaj încă (`lastMessage` lipsă). Astea urcă sus. Restul (citite, cu istoric)
 * sunt conversații obișnuite.
 */
function isNewOrUnread(chat: ChatSummary): boolean {
  return chat.unreadCount > 0 || !chat.lastMessage;
}

export default function MesajeScreen() {
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const { t } = useTranslation('chat');

  const { data, isLoading, isError, refetch } = useQuery<ChatSummary[]>({
    queryKey: ['chats'],
    queryFn: fetchChats,
    refetchInterval: REFETCH_MS,
  });

  // Momentul potrivit pentru permisiunea de notificări: userul are deja
  // conversații, deci așteaptă răspunsuri — notificarea îi este de folos ACUM.
  // (Hook-ul trebuie apelat înaintea return-urilor timpurii de mai jos.)
  usePushPermissionPrompt((data ?? []).length > 0);

  const chats = data ?? [];
  // Ecranul e complet gol doar când chat-urile s-au încărcat și nu-s: abia atunci
  // secțiunea „în așteptare" își arată textul de gol (altfel se ascunde de tot).
  const chatsEmpty = !isLoading && !isError && chats.length === 0;

  const newMatches = chats.filter(isNewOrUnread);
  const activeChats = chats.filter((c) => !isNewOrUnread(c));

  // Secțiunile goale nu se randează — antet fără rânduri = zgomot.
  const allSections: ChatSection[] = [
    { key: 'new', title: t('sections.newTitle'), hint: t('sections.newHint'), data: newMatches },
    { key: 'active', title: t('sections.activeTitle'), data: activeChats },
  ];
  const sections = allSections.filter((s) => s.data.length > 0);

  // Corpul zonei de chat-uri: distinct pentru loading / eroare / gol. Se
  // randează sub secțiunea „în așteptare" (care are stările ei proprii), deci
  // nu confiscă tot ecranul cât timp pending-ul are ceva de arătat.
  const chatsBody = isLoading ? (
    <View style={styles.bodyState}>
      <ActivityIndicator color={colors.accent} testID="chats-loading" />
    </View>
  ) : isError ? (
    <View style={styles.bodyState}>
      <Text style={[typography.body, styles.center, { color: colors.danger }]}>
        {t('loadError')}
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
        {t('retry')}
      </Text>
    </View>
  ) : (
    <View style={styles.bodyState}>
      <Text style={[typography.body, styles.center, { color: colors.textSecondary }]}>
        {t('empty')}
      </Text>
    </View>
  );

  return (
    <ScreenContainer>
      <Text style={[typography.h1, { color: colors.textPrimary, marginBottom: spacing.lg }]}>
        {t('title')}
      </Text>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.chatId}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        // „În așteptare" stă mereu deasupra chat-urilor, cu stările ei proprii.
        // `showEmpty` doar când ecranul ar fi altfel gol de tot.
        ListHeaderComponent={<PendingLikesSection showEmpty={chatsEmpty} />}
        // Când nu există nicio secțiune de chat-uri (loading/eroare/gol), corpul
        // de mai jos preia — nu lăsăm zona goală fără explicație.
        ListEmptyComponent={chatsBody}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        renderSectionHeader={({ section }) => (
          <View style={{ gap: spacing.xs, marginTop: spacing.md, marginBottom: spacing.sm }}>
            <Text style={[typography.h2, { color: colors.textPrimary }]}>{section.title}</Text>
            {section.hint ? (
              <Text style={[typography.caption, { color: colors.textSecondary }]}>
                {section.hint}
              </Text>
            ) : null}
          </View>
        )}
        renderItem={({ item }) => (
          <ChatListItem chat={item} onPress={() => router.push(`/chat/${item.chatId}`)} />
        )}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  center: {
    textAlign: 'center',
  },
  bodyState: {
    paddingVertical: 48,
    alignItems: 'center',
  },
});
