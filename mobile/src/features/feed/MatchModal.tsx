/** Modal „Connect! 💘" afișat la un match reciproc. */
import React from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { useTheme } from '@theme/index';

interface Props {
  visible: boolean;
  name: string;
  /** Deocamdată doar închide modalul (chatul se implementează ulterior). */
  onWriteMessage: () => void;
  onContinue: () => void;
}

export function MatchModal({ visible, name, onWriteMessage, onContinue }: Props) {
  const { colors, typography, radius, spacing } = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onContinue}
    >
      <View style={[styles.backdrop, { backgroundColor: colors.bg }]}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderRadius: radius.card,
              borderColor: colors.border,
              padding: spacing.xl,
              gap: spacing.md,
            },
          ]}
        >
          <Text style={[typography.display, styles.center, { color: colors.accent }]}>
            Connect! 💘
          </Text>
          <Text
            style={[typography.body, styles.center, { color: colors.textSecondary }]}
          >
            Tu și {name} v-ați plăcut reciproc.
          </Text>

          <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
            <Button label="Scrie un mesaj" onPress={onWriteMessage} testID="match-write" />
            <Button
              label="Continuă"
              variant="ghost"
              onPress={onContinue}
              testID="match-continue"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
  },
  center: {
    textAlign: 'center',
  },
});
