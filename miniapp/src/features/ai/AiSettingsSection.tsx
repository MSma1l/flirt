/**
 * Secțiunea „Asistent AI" din ecranul de Setări.
 *
 * DE CE E UN COMPONENT SEPARAT, montat de `SettingsScreen`: ecranul de Setări e
 * împărțit între mai mulți autori, iar tot ce ține de AI (rețea, stări, texte,
 * teste) trebuie să stea într-un singur loc, `features/ai/`. Integrarea în ecran
 * e un import și o linie de JSX.
 *
 * REGULA DE PRODUS, nu o preferință de design: comutatorul e OPRIT implicit și
 * explicația stă LÂNGĂ el, nu în subsol, nu după un „află mai multe". Funcția
 * trimite ultimele mesaje din conversație către un furnizor extern; cine o
 * pornește trebuie să afle asta în momentul în care apasă, nu după.
 *
 * Fără `alert()` / `confirm()`: dialogurile native blochează WebView-ul Telegram.
 */
import { useTranslation } from 'react-i18next';

import { useAiEnabled, useSetAiEnabled } from './aiSettings';

import './ai.css';

export function AiSettingsSection() {
  const { t } = useTranslation(['miniapp', 'settings']);
  const { enabled, isLoading, isError, refetch } = useAiEnabled();
  const setEnabled = useSetAiEnabled();

  return (
    <section className="settings-section" data-testid="ai-settings-section">
      <h2 className="settings-section__title">{t('miniapp:ai.settings.title')}</h2>

      {/* Explicația vine ÎNAINTEA comutatorului: se citește pe drumul spre el. */}
      <p className="body-text ai-consent" data-testid="ai-consent">
        {t('miniapp:ai.settings.consent')}
      </p>

      {isLoading ? (
        <div className="ai-inline" data-testid="ai-settings-loading">
          <span className="spinner spinner--sm" role="status" aria-label={t('miniapp:ai.loading')} />
          <span className="caption">{t('miniapp:ai.loading')}</span>
        </div>
      ) : isError ? (
        // Eroare MICĂ, în interiorul ecranului: restul setărilor funcționează,
        // deci un `StatusScreen` peste tot ar fi o exagerare.
        <div className="ai-inline" data-testid="ai-settings-load-error">
          <p className="error-text">{t('miniapp:ai.settings.loadError')}</p>
          <button
            type="button"
            className="button button--ghost"
            data-testid="ai-settings-retry"
            onClick={() => void refetch()}
          >
            {t('miniapp:ai.retry')}
          </button>
        </div>
      ) : (
        <>
          <label className="settings-toggle">
            <span className="body-text settings-toggle__label">
              {t('miniapp:ai.settings.toggleLabel')}
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={enabled}
              disabled={setEnabled.isPending}
              onChange={(e) => setEnabled.mutate(e.target.checked)}
              data-testid="ai-enabled"
            />
          </label>

          <p className="caption" data-testid="ai-settings-state">
            {enabled ? t('miniapp:ai.settings.stateOn') : t('miniapp:ai.settings.stateOff')}
          </p>

          {setEnabled.isError ? (
            <p className="error-text" role="alert" data-testid="ai-settings-save-error">
              {t('miniapp:ai.settings.saveError')}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

export default AiSettingsSection;
