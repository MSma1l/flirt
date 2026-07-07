/** Bulă de mesaj: aliniere + culoare după emitent; hint discret dacă e mascat.
 *  Long-press deschide un picker de reacții; reacția setată apare ca badge. */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@theme/index';

import { ChatMessage } from './types';

/** Emoji-urile disponibile în picker-ul de reacții. */
export const REACTIONS = ['❤️', '😂', '👍', '🔥'] as const;

interface Props {
  message: ChatMessage;
  /** Id-ul utilizatorului curent, pentru a decide alinierea. */
  currentUserId: string;
  /** Aplică o reacție (emoji) sau o scoate (null, la re-selectarea aceluiași). */
  onReact?: (reaction: string | null) => void;
}

export function MessageBubble({ message, currentUserId, onReact }: Props) {
  const { colors, typography, spacing, radius } = useTheme();
  const isOwn = message.senderId === currentUserId;
  const [pickerOpen, setPickerOpen] = useState(false);

  const handlePick = (emoji: string) => {
    setPickerOpen(false);
    // Re-selectarea aceleiași reacții o scoate.
    onReact?.(message.reaction === emoji ? null : emoji);
  };

  return (
    <View
      testID="message-bubble"
      accessibilityLabel={isOwn ? 'mesaj propriu' : 'mesaj primit'}
      style={[styles.wrap, isOwn ? styles.wrapOwn : styles.wrapOther]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reacționează la mesaj"
        onLongPress={onReact ? () => setPickerOpen(true) : undefined}
        delayLongPress={300}
        style={[
          styles.bubble,
          {
            backgroundColor: isOwn ? colors.accent : colors.surface,
            borderRadius: radius.card,
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.md,
          },
        ]}
      >
        <Text style={[typography.body, { color: isOwn ? colors.onAccent : colors.textPrimary }]}>
          {message.body}
        </Text>
      </Pressable>

      {message.reaction ? (
        <View
          testID="reaction-badge"
          accessibilityLabel={`Reacție: ${message.reaction}`}
          style={[
            styles.reaction,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radius.pill,
            },
          ]}
        >
          <Text style={typography.caption}>{message.reaction}</Text>
        </View>
      ) : null}

      {pickerOpen ? (
        <View
          testID="reaction-picker"
          style={[
            styles.picker,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radius.pill,
              padding: spacing.xs,
              gap: spacing.xs,
            },
          ]}
        >
          {REACTIONS.map((emoji) => (
            <Pressable
              key={emoji}
              accessibilityRole="button"
              accessibilityLabel={`Reacție ${emoji}`}
              testID={`reaction-option-${emoji}`}
              onPress={() => handlePick(emoji)}
              hitSlop={6}
              style={styles.pickerItem}
            >
              <Text style={typography.body}>{emoji}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {message.wasMasked ? (
        <Text
          testID="masked-hint"
          style={[
            typography.caption,
            styles.hint,
            { color: colors.textSecondary, marginTop: spacing.xs },
          ]}
        >
          Contact ascuns pentru siguranță
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    maxWidth: '80%',
    marginVertical: 4,
  },
  wrapOwn: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  wrapOther: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  bubble: {
    flexShrink: 1,
  },
  hint: {
    paddingHorizontal: 4,
  },
  reaction: {
    marginTop: -6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
  },
  picker: {
    flexDirection: 'row',
    marginTop: 4,
    borderWidth: 1,
  },
  pickerItem: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
});
