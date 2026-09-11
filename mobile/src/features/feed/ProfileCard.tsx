/** Cardul de profil din deck: foto/placeholder, overlay cu date, interese, badge. */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { ReportModal } from '@/features/moderation/ReportModal';
import { useBlockUser } from '@/features/social/useBlockUser';
import { useFavorite } from '@/features/social/useFavorite';
import { useTheme } from '@theme/index';

import { CompatBadge } from './CompatBadge';
import { FeedCard } from './types';

interface Props {
  card: FeedCard;
}

function ProfileCardBase({ card }: Props) {
  const { colors, typography, radius, spacing } = useTheme();
  const { t } = useTranslation('feed');
  const hasPhoto = card.photos.length > 0;
  const initial = card.name.trim().charAt(0).toUpperCase() || '?';
  const interests = card.topInterests.slice(0, 3);
  const [reportOpen, setReportOpen] = useState(false);
  const { confirmBlock, isBlocking } = useBlockUser();
  const { isFavorite, markFavorite, isAdding } = useFavorite(card.userId);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderRadius: radius.card,
          borderColor: colors.border,
        },
      ]}
    >
      {/* Zonă foto sau placeholder colorat cu inițiala */}
      <View style={styles.photo}>
        {hasPhoto ? (
          <Image
            source={{ uri: card.photos[0] }}
            style={styles.photoImage}
            resizeMode="cover"
          />
        ) : (
          <View
            style={[styles.placeholder, { backgroundColor: colors.tagBg }]}
          >
            <Text style={[typography.display, { color: colors.accent }]}>
              {initial}
            </Text>
          </View>
        )}

        {/* Badge de compatibilitate sus-dreapta */}
        <View style={styles.badgeWrap}>
          <CompatBadge score={card.compatibility} />
        </View>

        {/* Butoane discrete sus-stânga: favorit, raportare, blocare */}
        <View style={[styles.safetyWrap, { gap: spacing.sm }]}>
          {/* ★ = adaugă la favorite. Steaua plină + butonul dezactivat arată
              că profilul e DEJA la favorite (fără să pară că apăsarea n-a mers). */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(isFavorite ? 'card.alreadyFavorite' : 'card.favorite')}
            accessibilityState={{ selected: isFavorite, disabled: isFavorite || isAdding }}
            disabled={isFavorite || isAdding}
            onPress={markFavorite}
            hitSlop={8}
            testID="card-favorite"
            style={[
              styles.safetyBtn,
              { backgroundColor: colors.surface, borderRadius: radius.pill },
            ]}
          >
            <Text style={[typography.badge, { color: colors.accent }]}>
              {isFavorite ? '★' : '☆'}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('card.report')}
            onPress={() => setReportOpen(true)}
            hitSlop={8}
            testID="card-report"
            style={[
              styles.safetyBtn,
              { backgroundColor: colors.surface, borderRadius: radius.pill },
            ]}
          >
            <Text style={[typography.badge, { color: colors.warning }]}>⚠</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('card.block')}
            disabled={isBlocking}
            onPress={() => confirmBlock(card.userId, card.name)}
            hitSlop={8}
            testID="card-block"
            style={[
              styles.safetyBtn,
              { backgroundColor: colors.surface, borderRadius: radius.pill },
            ]}
          >
            <Text style={[typography.badge, { color: colors.danger }]}>🚫</Text>
          </Pressable>
        </View>

        {/* Overlay jos cu detalii */}
        <View
          style={[styles.overlay, { backgroundColor: colors.surface }]}
        >
          <Text style={[typography.h1, { color: colors.textPrimary }]}>
            {card.name}, {card.age}
          </Text>
          <Text
            style={[
              typography.caption,
              { color: colors.textSecondary, marginTop: spacing.xs },
            ]}
          >
            {card.distanceKm !== undefined
              ? t('card.cityWithDistance', {
                  city: card.city,
                  km: Math.round(card.distanceKm),
                })
              : card.city}
          </Text>

          {card.about ? (
            <Text
              numberOfLines={2}
              style={[
                typography.body,
                { color: colors.textPrimary, marginTop: spacing.sm },
              ]}
            >
              {card.about}
            </Text>
          ) : null}

          {interests.length > 0 ? (
            <View style={[styles.chips, { marginTop: spacing.md }]}>
              {interests.map((interest) => (
                <View
                  key={interest}
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
                  <Text style={[typography.caption, { color: colors.link }]}>
                    {interest}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>

      {reportOpen ? (
        <ReportModal
          visible={reportOpen}
          reportedUserId={card.userId}
          onClose={() => setReportOpen(false)}
        />
      ) : null}
    </View>
  );
}

/** Memoizat: deck-ul face mai multe setState per swipe (`busy`, `actionError`);
 *  cardul depinde doar de `card`, deci nu trebuie re-randat între ele. */
export const ProfileCard = React.memo(ProfileCardBase);

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderWidth: 1,
    overflow: 'hidden',
  },
  photo: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  photoImage: {
    ...StyleSheet.absoluteFillObject,
  },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeWrap: {
    position: 'absolute',
    top: 16,
    right: 16,
  },
  safetyWrap: {
    position: 'absolute',
    top: 16,
    left: 16,
    flexDirection: 'row',
  },
  safetyBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.85,
  },
  overlay: {
    padding: 16,
    opacity: 0.96,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    alignSelf: 'flex-start',
  },
});
