/** Sheet afișat la LIKE: mesaj de deschidere (variante rapide + text liber) sau doar like. */
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Input } from '@/components/ui';
import { useTheme } from '@theme/index';

interface Props {
  visible: boolean;
  /** Numele persoanei căreia i-am dat like (pentru titlu). */
  name: string;
  /** Confirmă like cu mesajul scris. */
  onSend: (message: string) => void;
  /** Confirmă like fără mesaj („Doar like"). */
  onSkip: () => void;
  /** Închide sheet-ul fără a face swipe (ex. gestul de închidere). */
  onClose: () => void;
}

/** Variante rapide de mesaj de deschidere. */
const QUICK_MESSAGES = ['Salut 👋', 'Salut, ce faci?'] as const;

export function SendFirstMessageSheet({ visible, name, onSend, onSkip, onClose }: Props) {
  const { colors, typography, radius, spacing } = useTheme();
  const [text, setText] = useState('');

  // Resetăm câmpul de fiecare dată când sheet-ul se deschide pentru un card nou.
  useEffect(() => {
    if (visible) setText('');
  }, [visible]);

  const trimmed = text.trim();
  const canSend = trimmed.length > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={[styles.backdrop, { backgroundColor: colors.scrim }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Închide"
      >
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderTopLeftRadius: radius.card,
              borderTopRightRadius: radius.card,
              borderColor: colors.border,
              padding: spacing.xl,
              gap: spacing.md,
            },
          ]}
          // Blocăm propagarea către backdrop (apăsare în interiorul sheet-ului).
          onPress={() => {}}
        >
          <Text style={[typography.h1, { color: colors.textPrimary }]}>
            Scrie-i lui {name}
          </Text>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            Un mesaj de deschidere crește șansele la răspuns.
          </Text>

          <View style={[styles.chips, { gap: spacing.sm, marginTop: spacing.xs }]}>
            {QUICK_MESSAGES.map((msg) => (
              <Pressable
                key={msg}
                testID={`first-msg-quick-${msg}`}
                accessibilityRole="button"
                accessibilityLabel={msg}
                onPress={() => setText(msg)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: colors.tagBg,
                    borderRadius: radius.pill,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.xs,
                  },
                ]}
              >
                <Text style={[typography.caption, { color: colors.link }]}>{msg}</Text>
              </Pressable>
            ))}
          </View>

          <Input
            testID="first-msg-input"
            placeholder="Scrie un mesaj..."
            value={text}
            onChangeText={setText}
            multiline
          />

          <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
            <Button
              label="Trimite"
              testID="first-msg-send"
              disabled={!canSend}
              onPress={() => onSend(trimmed)}
            />
            <Button
              label="Doar like"
              variant="ghost"
              testID="first-msg-skip"
              onPress={onSkip}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    width: '100%',
    borderWidth: 1,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  chip: {
    alignSelf: 'flex-start',
  },
});
