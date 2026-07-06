/** Bulă de mesaj: aliniere + culoare după emitent; hint discret dacă e mascat. */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@theme/index';

import { ChatMessage } from './types';

interface Props {
  message: ChatMessage;
  /** Id-ul utilizatorului curent, pentru a decide alinierea. */
  currentUserId: string;
}

export function MessageBubble({ message, currentUserId }: Props) {
  const { colors, typography, spacing, radius } = useTheme();
  const isOwn = message.senderId === currentUserId;

  return (
    <View
      testID="message-bubble"
      accessibilityLabel={isOwn ? 'mesaj propriu' : 'mesaj primit'}
      style={[styles.wrap, isOwn ? styles.wrapOwn : styles.wrapOther]}
    >
      <View
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
      </View>

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
});
