/**
 * Secțiunea „Confidențialitate și documente" din Setări: doar legături, fără
 * cereri de rețea — documentele și acțiunile asupra datelor stau în centrul de
 * confidențialitate (`PrivacyCenterScreen`).
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Icon } from '@/components/icons';

import { LEGAL_HUB_PATH, legalDocPath } from './legalRoutes';

export function LegalSettingsSection() {
  const { t } = useTranslation('screens');
  const entries = [
    { to: legalDocPath('privacy'), label: t('legal.docTitle.privacy'), testId: 'settings-legal-privacy' },
    { to: legalDocPath('terms'), label: t('legal.docTitle.terms'), testId: 'settings-legal-terms' },
    { to: LEGAL_HUB_PATH, label: t('legal.center.title'), testId: 'settings-legal-center' },
  ];
  return (
    <section className="settings-section" data-testid="settings-legal">
      <h2 className="settings-section__title">{t('legal.settingsTitle')}</h2>
      <nav className="more-list" aria-label={t('legal.settingsTitle')}>
        {entries.map((entry) => (
          <Link key={entry.to} to={entry.to} className="more-item" data-testid={entry.testId}>
            <span className="more-item__label">{entry.label}</span>
            <Icon name="chevron" className="more-item__chevron" />
          </Link>
        ))}
      </nav>
    </section>
  );
}

export default LegalSettingsSection;
