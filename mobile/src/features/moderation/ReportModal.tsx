/** Modal de raportare utilizator (TZ 5.5): categorie + notă opțională → POST /reports/. */
import { useMutation } from '@tanstack/react-query';
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Input } from '@/components/ui';
import { firstError, LIMITS, maxLen, noHtml } from '@/utils/validation';
import { useTheme } from '@theme/index';

import { sendReport } from './reportApi';
import { ReportCategory } from './types';

interface Props {
  visible: boolean;
  reportedUserId: string;
  chatId?: string;
  onClose: () => void;
}

/** Categoriile cu etichete în română, în ordinea afișării. */
const CATEGORIES: { value: ReportCategory; label: string }[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'fake', label: 'Profil fals' },
  { value: 'offensive', label: 'Limbaj ofensator' },
  { value: 'obscene', label: 'Conținut obscen' },
];

export function ReportModal({ visible, reportedUserId, chatId, onClose }: Props) {
  const { colors, typography, radius, spacing } = useTheme();
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);

  // Resetează starea de fiecare dată când modalul se deschide.
  useEffect(() => {
    if (visible) {
      setCategory(null);
      setNote('');
      setSent(false);
    }
  }, [visible]);

  const mutation = useMutation({
    mutationFn: () =>
      sendReport({
        reportedUserId,
        category: category as ReportCategory,
        chatId,
        note,
      }),
    onSuccess: () => setSent(true),
  });

  // Nota e opțională: ≤500 caractere + fără marcaje HTML (simetric cu backend).
  const noteError = firstError(maxLen(note, LIMITS.note), noHtml(note));
  const canSubmit = category !== null && !noteError && !mutation.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    mutation.mutate();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, { backgroundColor: colors.scrim }]}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderRadius: radius.card,
              padding: spacing.xl,
              gap: spacing.md,
            },
          ]}
        >
          {sent ? (
            <>
              <Text style={[typography.h2, { color: colors.textPrimary }]}>
                Mulțumim, am primit raportul
              </Text>
              <Button label="Închide" onPress={onClose} />
            </>
          ) : (
            <>
              <Text style={[typography.h2, { color: colors.textPrimary }]}>
                Raportează
              </Text>

              <View style={{ gap: spacing.sm }}>
                {CATEGORIES.map((c) => {
                  const selected = category === c.value;
                  return (
                    <Pressable
                      key={c.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => setCategory(c.value)}
                      style={{
                        borderWidth: 1.5,
                        borderColor: selected ? colors.accent : colors.border,
                        backgroundColor: selected ? colors.tagBg : colors.bg,
                        borderRadius: radius.md,
                        paddingHorizontal: spacing.lg,
                        paddingVertical: spacing.md,
                      }}
                    >
                      <Text
                        style={[
                          typography.bodyStrong,
                          { color: selected ? colors.accent : colors.textPrimary },
                        ]}
                      >
                        {c.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Input
                label="Notă (opțional)"
                value={note}
                onChangeText={setNote}
                error={noteError}
                maxLength={LIMITS.note}
                placeholder="Detalii suplimentare…"
                multiline
              />

              {mutation.isError ? (
                <Text style={[typography.caption, { color: colors.danger }]}>
                  Nu am putut trimite raportul. Încearcă din nou.
                </Text>
              ) : null}

              <Button
                label="Trimite raportul"
                onPress={handleSubmit}
                disabled={!canSubmit}
                loading={mutation.isPending}
              />
              <Button label="Anulează" variant="ghost" onPress={onClose} />
            </>
          )}
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
    maxWidth: 420,
  },
});
