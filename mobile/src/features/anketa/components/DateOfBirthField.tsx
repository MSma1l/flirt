/**
 * Câmp „Data nașterii" cu CALENDAR (nu tastare).
 *
 * Folosește `@react-native-community/datetimepicker` (inclus în Expo Go).
 * ENFORCE 18+: data maximă selectabilă = azi − 18 ani, iar data implicită la
 * deschidere (când nu există încă o valoare) = tot azi − 18 ani. Astfel e
 * IMPOSIBIL să alegi o dată care te face mai mic de 18.
 *
 * Contractul cu backend-ul NU se schimbă: în sus trimite tot ISO `YYYY-MM-DD`,
 * exact ca inputul text de dinainte. Afișarea e frumoasă: `dd.mm.yyyy`.
 */
import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import React, { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@theme/index';

import { MIN_AGE } from '../validation';

/** Data maximă selectabilă: azi − MIN_AGE ani (pragul de adult, 18+). */
export function maxBirthDate(now: Date = new Date()): Date {
  return new Date(now.getFullYear() - MIN_AGE, now.getMonth(), now.getDate());
}

/** Formatează un `Date` în ISO local `YYYY-MM-DD` (fără drift de fus orar). */
export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parsează un ISO `YYYY-MM-DD` la `Date` local; `undefined` dacă e invalid. */
export function parseIsoDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return undefined;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

/** Formatează ISO `YYYY-MM-DD` pentru afișare ca `dd.mm.yyyy`. */
export function formatDisplayDate(value?: string): string | null {
  const date = parseIsoDate(value);
  if (!date) return null;
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}.${m}.${date.getFullYear()}`;
}

interface Props {
  label: string;
  /** Valoarea curentă în ISO `YYYY-MM-DD` (sau gol). */
  value?: string;
  /** Notifică noua valoare, tot în ISO `YYYY-MM-DD`. */
  onChange: (isoDate: string) => void;
  error?: string;
}

export function DateOfBirthField({ label, value, onChange, error }: Props) {
  const { colors, typography, radius, spacing } = useTheme();
  const [show, setShow] = useState(false);

  const maxDate = maxBirthDate();
  // Valoarea afișată în picker: cea aleasă, altfel pragul de adult (18+).
  const current = parseIsoDate(value) ?? maxDate;
  const display = formatDisplayDate(value);

  const commit = (date: Date) => {
    // Plasa de siguranță pe lângă `maximumDate`: nu lăsăm nicio dată < 18 ani.
    const clamped = date > maxDate ? maxDate : date;
    onChange(toIsoDate(clamped));
  };

  const onAndroidChange = (event: DateTimePickerEvent, date?: Date) => {
    setShow(false);
    if (event.type === 'set' && date) commit(date);
  };

  const borderColor = error ? colors.danger : colors.border;

  return (
    <View style={{ gap: spacing.xs, width: '100%' }}>
      <Text style={[typography.caption, { color: colors.textSecondary }]}>{label}</Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        testID="birthdate-open"
        onPress={() => setShow(true)}
        style={[
          styles.field,
          {
            backgroundColor: colors.surface,
            borderColor,
            borderRadius: radius.md,
          },
        ]}
      >
        <Text
          style={[
            typography.body,
            { color: display ? colors.textPrimary : colors.textDisabled },
          ]}
        >
          {display ?? 'Alege data din calendar'}
        </Text>
      </Pressable>

      {error ? (
        <Text style={[typography.caption, { color: colors.danger }]}>{error}</Text>
      ) : null}

      {show && Platform.OS === 'android' ? (
        <DateTimePicker
          testID="birthdate-picker"
          mode="date"
          display="calendar"
          value={current}
          maximumDate={maxDate}
          onChange={onAndroidChange}
        />
      ) : null}

      {Platform.OS === 'ios' ? (
        <Modal visible={show} transparent animationType="slide">
          <Pressable style={styles.backdrop} onPress={() => setShow(false)}>
            <Pressable
              style={[styles.sheet, { backgroundColor: colors.surface }]}
              onPress={(e) => e.stopPropagation()}
            >
              <DateTimePicker
                testID="birthdate-picker"
                mode="date"
                display="spinner"
                value={current}
                maximumDate={maxDate}
                textColor={colors.textPrimary}
                onChange={(_event: DateTimePickerEvent, date?: Date) => {
                  if (date) commit(date);
                }}
              />
              <Pressable
                accessibilityRole="button"
                testID="birthdate-done"
                onPress={() => setShow(false)}
                style={[styles.doneBtn, { backgroundColor: colors.accent }]}
              >
                <Text style={[typography.bodyStrong, { color: colors.onAccent }]}>
                  Gata
                </Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 14 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    paddingTop: 12,
    paddingBottom: 32,
    paddingHorizontal: 16,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    gap: 12,
  },
  doneBtn: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 14,
  },
});
