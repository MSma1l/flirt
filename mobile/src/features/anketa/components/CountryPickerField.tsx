/**
 * Câmp „Naționalitate" cu SELECTOR DE ȚARĂ: la apăsare deschide un modal cu
 * TOATE țările lumii, fiecare cu STEAG, plus o bară de CĂUTARE care filtrează
 * lista după numele țării (RO sau EN) în timp real.
 *
 * STEAGURI: emoji-urile de steag (🇺🇸) NU se randează pe multe Android (arată
 * codul din 2 litere). De aceea folosim `react-native-country-flag`, care
 * randează steagul ca IMAGINE (PNG din flagcdn.com) — identic pe Android și iOS.
 *
 * Ce se salvează în `nationality`: CODUL ISO2 (ex. "MD"). E canonic, stabil și
 * încape lejer în textul liber acceptat de backend. Valorile vechi (nume de
 * țară scris liber) sunt rezolvate la afișare prin `findCountry`.
 */
import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import CountryFlag from 'react-native-country-flag';

import { useTheme } from '@theme/index';

import { Country, findCountry, searchCountries } from '../countries';

interface Props {
  label: string;
  /** Valoarea curentă din `nationality` (cod ISO2 nou sau text vechi). */
  value?: string;
  /** Notifică noua valoare — CODUL ISO2 al țării alese. */
  onChange: (isoCode: string) => void;
}

export function CountryPickerField({ label, value, onChange }: Props) {
  const { colors, typography, radius, spacing } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = findCountry(value);
  const results = useMemo(() => searchCountries(query), [query]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const pick = (country: Country) => {
    onChange(country.code);
    close();
  };

  const renderItem = ({ item }: { item: Country }) => {
    const isSelected = selected?.code === item.code;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected }}
        testID={`country-item-${item.code}`}
        onPress={() => pick(item)}
        style={[
          styles.row,
          { borderColor: colors.border },
          isSelected ? { backgroundColor: colors.tagBg } : null,
        ]}
      >
        <CountryFlag isoCode={item.code} size={22} style={styles.flag} />
        <Text
          style={[
            typography.body,
            { color: isSelected ? colors.accent : colors.textPrimary, flex: 1 },
          ]}
        >
          {item.name}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={{ gap: spacing.xs, width: '100%' }}>
      <Text style={[typography.caption, { color: colors.textSecondary }]}>{label}</Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        testID="nationality-open"
        onPress={() => setOpen(true)}
        style={[
          styles.field,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radius.md,
          },
        ]}
      >
        {selected ? (
          <>
            <CountryFlag isoCode={selected.code} size={20} style={styles.flag} />
            <Text style={[typography.body, { color: colors.textPrimary, flex: 1 }]}>
              {selected.name}
            </Text>
          </>
        ) : (
          <Text style={[typography.body, { color: colors.textDisabled, flex: 1 }]}>
            {value?.trim() ? value : 'Alege țara'}
          </Text>
        )}
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={close}>
        <View style={[styles.modal, { backgroundColor: colors.bg }]}>
          <View style={styles.modalHeader}>
            <Text style={[typography.h2, { color: colors.textPrimary, flex: 1 }]}>
              Naționalitate
            </Text>
            <Pressable
              accessibilityRole="button"
              testID="nationality-close"
              onPress={close}
              hitSlop={12}
            >
              <Text style={[typography.bodyStrong, { color: colors.accent }]}>Închide</Text>
            </Pressable>
          </View>

          <TextInput
            testID="nationality-search"
            placeholder="Caută țara..."
            placeholderTextColor={colors.textDisabled}
            autoCorrect={false}
            value={query}
            onChangeText={setQuery}
            style={[
              typography.body,
              styles.search,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radius.md,
                color: colors.textPrimary,
              },
            ]}
          />

          <FlatList
            data={results as Country[]}
            keyExtractor={(c) => c.code}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={16}
            style={{ flex: 1 }}
            ListEmptyComponent={
              <Text
                style={[
                  typography.body,
                  { color: colors.textSecondary, textAlign: 'center', padding: spacing.xl },
                ]}
              >
                Nicio țară găsită.
              </Text>
            }
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  flag: { borderRadius: 3 },
  modal: { flex: 1, paddingTop: 56, paddingHorizontal: 16, gap: 12 },
  modalHeader: { flexDirection: 'row', alignItems: 'center' },
  search: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
