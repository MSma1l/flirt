/**
 * Bara de răspuns la o poveste (ca la Instagram): un rând de reacții-emoji +
 * un câmp de text liber.
 *
 * DOUĂ REGULI care nu sunt cosmetice:
 *
 * 1. NU e copil al zonelor de tap prev/next din vizualizator. Pe web `Pressable`
 *    devine `<button>`, iar un `<button>` în alt `<button>` e HTML invalid: tap-ul
 *    pe emoji ar ajunge la zona de navigare și ar sări povestea.
 * 2. Anunță părintele când devine ACTIVĂ (focus sau text scris), ca acesta să
 *    oprească progresul poveștii. Altfel povestea avansează în timp ce userul
 *    tastează, iar mesajul pleacă la altcineva (sau ecranul se închide).
 */
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useTheme } from '@theme/index';

/** Reacțiile rapide: tap = trimitere imediată, fără tastatură. */
export const QUICK_REACTIONS = ['❤️', '😂', '😮', '😍', '👏', '🔥'] as const;

/** Plafon aliniat cu `STORY_REPLY_MAX_LENGTH` din backend (422 peste el). */
const REPLY_MAX_LENGTH = 500;

export interface StoryReplyBarProps {
  /** Numele autorului poveștii — apare în placeholder („Răspunde-i Anei…"). */
  authorName?: string;
  /** Trimite răspunsul (text sau emoji). Părintele decide ce face cu erorile. */
  onSend: (body: string) => void;
  /** Un răspuns e în zbor: dezactivăm controalele și arătăm spinner-ul. */
  sending?: boolean;
  /** Ultimul răspuns a plecat cu succes → confirmare discretă „Trimis". */
  sent?: boolean;
  /**
   * Bara e activă (focus pe câmp sau text scris) → părintele oprește progresul.
   * Se cheamă DOAR la schimbarea stării, nu la fiecare tastă.
   */
  onActiveChange?: (active: boolean) => void;
}

export function StoryReplyBar({
  authorName,
  onSend,
  sending = false,
  sent = false,
  onActiveChange,
}: StoryReplyBarProps) {
  const { colors, typography, radius, spacing } = useTheme();
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);

  const trimmed = text.trim();
  const canSend = trimmed.length > 0 && !sending;

  /** Sursa unică de adevăr pentru „bara e activă" → un singur apel la schimbare. */
  const setActive = (nextFocused: boolean, nextText: string) => {
    const before = focused || text.trim().length > 0;
    const after = nextFocused || nextText.trim().length > 0;
    if (before !== after) onActiveChange?.(after);
  };

  const changeText = (v: string) => {
    setActive(focused, v);
    setText(v);
  };

  const send = (body: string) => {
    if (!body.trim() || sending) return;
    onSend(body.trim());
    // Golim câmpul optimist: părintele afișează eroarea dacă trimiterea pică.
    setActive(focused, '');
    setText('');
  };

  const placeholder = authorName ? `Răspunde-i lui ${authorName}…` : 'Trimite un mesaj…';

  return (
    <View style={styles.wrap} testID="story-reply-bar">
      {/* Reacții rapide: tap = trimitere imediată. */}
      <View style={[styles.reactions, { gap: spacing.xs }]}>
        {QUICK_REACTIONS.map((emoji) => (
          <Pressable
            key={emoji}
            accessibilityRole="button"
            accessibilityLabel={`Reacționează cu ${emoji}`}
            disabled={sending}
            onPress={() => send(emoji)}
            hitSlop={spacing.xs}
            style={[
              styles.reaction,
              {
                backgroundColor: colors.surface,
                borderRadius: radius.pill,
                opacity: sending ? 0.5 : 1,
              },
            ]}
          >
            <Text style={styles.emoji}>{emoji}</Text>
          </Pressable>
        ))}
      </View>

      {/* Câmp de text liber + trimitere. */}
      <View
        style={[
          styles.inputRow,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radius.pill,
            paddingLeft: spacing.md,
            paddingRight: spacing.xs,
            gap: spacing.sm,
          },
        ]}
      >
        <TextInput
          testID="story-reply-input"
          accessibilityLabel="Scrie un răspuns la poveste"
          value={text}
          onChangeText={changeText}
          onFocus={() => {
            setActive(true, text);
            setFocused(true);
          }}
          onBlur={() => {
            setActive(false, text);
            setFocused(false);
          }}
          onSubmitEditing={() => send(text)}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          maxLength={REPLY_MAX_LENGTH}
          editable={!sending}
          returnKeyType="send"
          blurOnSubmit={false}
          style={[typography.body, styles.input, { color: colors.textPrimary }]}
        />
        {sending ? (
          <ActivityIndicator testID="story-reply-sending" color={colors.accent} />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Trimite răspunsul"
            disabled={!canSend}
            onPress={() => send(text)}
            hitSlop={spacing.xs}
            style={[styles.send, { opacity: canSend ? 1 : 0.4 }]}
          >
            <Text style={[typography.bodyStrong, { color: colors.accent }]}>Trimite</Text>
          </Pressable>
        )}
      </View>

      {sent ? (
        <Text style={[typography.caption, { color: colors.textSecondary }]}>Trimis ✓</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', gap: 8 },
  reactions: { flexDirection: 'row', justifyContent: 'space-between' },
  reaction: { paddingHorizontal: 10, paddingVertical: 6 },
  emoji: { fontSize: 22, lineHeight: 26 },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, minHeight: 44 },
  input: { flex: 1, paddingVertical: 10 },
  send: { paddingHorizontal: 8, paddingVertical: 8 },
});
