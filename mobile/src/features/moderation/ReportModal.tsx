/** Modal de raportare utilizator (TZ 5.5): categorie + notă opțională → POST /reports/. */
import { useMutation } from '@tanstack/react-query';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

/**
 * Categoriile, în ordinea afișării. Aici stă doar ORDINEA și valoarea trimisă
 * serverului; eticheta vine din catalog (`report.categories.<valoare>`), ca
 * lista să nu trebuiască rescrisă la fiecare limbă nouă.
 */
const CATEGORIES: readonly ReportCategory[] = ['spam', 'fake', 'offensive', 'obscene'];

export function ReportModal({ visible, reportedUserId, chatId, onClose }: Props) {
  const { colors, typography, radius, spacing } = useTheme();
  // „Închide" și „Anulează" sunt acțiuni generice — stau în `common`, nu aici.
  const { t } = useTranslation(['moderation', 'common']);
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
                {t('report.thanks')}
              </Text>
              <Button label={t('common:actions.close')} onPress={onClose} />
            </>
          ) : (
            <>
              <Text style={[typography.h2, { color: colors.textPrimary }]}>
                {t('report.title')}
              </Text>

              <View style={{ gap: spacing.sm }}>
                {CATEGORIES.map((value) => {
                  const selected = category === value;
                  return (
                    <Pressable
                      key={value}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => setCategory(value)}
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
                        {t(`report.categories.${value}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Input
                label={t('report.noteLabel')}
                value={note}
                onChangeText={setNote}
                error={noteError}
                maxLength={LIMITS.note}
                placeholder={t('report.notePlaceholder')}
                multiline
              />

              {mutation.isError ? (
                <Text style={[typography.caption, { color: colors.danger }]}>
                  {t('report.sendError')}
                </Text>
              ) : null}

              <Button
                label={t('report.submit')}
                onPress={handleSubmit}
                disabled={!canSubmit}
                loading={mutation.isPending}
              />
              <Button label={t('common:actions.cancel')} variant="ghost" onPress={onClose} />
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
