/**
 * Cronologia unei comenzi: Comandat → Plătit → Aprobat → Bilet.
 *
 * Varianta `compact` (pe cardul din listă) e doar decor — puncte și linii;
 * varianta plină (în detaliu) e o listă cu etichete și starea fiecărui pas.
 */
import { useTranslation } from 'react-i18next';

import { CheckIcon, CrossIcon } from './TicketIcons';
import { STEPS, stepStates, type OrderStage, type StepState } from './orderStage';

const STATE_LABEL: Record<StepState, string> = {
  done: 'tickets.stepState.done',
  current: 'tickets.stepState.current',
  upcoming: 'tickets.stepState.upcoming',
  failed: 'tickets.stepState.failed',
};

export function OrderStepper({
  stage,
  hasCode,
  compact,
}: {
  stage: OrderStage;
  hasCode: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation('screens');
  const states = stepStates(stage, hasCode);

  if (compact) {
    // Pe card (în interiorul unui <button>): doar decor, fără listă — starea
    // e spusă în cuvinte de eticheta de lângă.
    return (
      <span className="tk-stepper tk-stepper--compact" aria-hidden="true">
        {STEPS.map((step) => (
          <span key={step} className={`tk-stepper__step tk-stepper__step--${states[step]}`}>
            <span className="tk-stepper__dot" />
          </span>
        ))}
      </span>
    );
  }

  return (
    <ol
      className="tk-stepper"
      aria-label={t('tickets.stepperLabel')}
      data-testid="order-stepper"
    >
      {STEPS.map((step) => {
        const state = states[step];
        return (
          <li
            key={step}
            className={`tk-stepper__step tk-stepper__step--${state}`}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="tk-stepper__dot" aria-hidden="true">
              {state === 'done' ? <CheckIcon width={12} height={12} strokeWidth={2.6} /> : null}
              {state === 'failed' ? <CrossIcon width={12} height={12} strokeWidth={2.6} /> : null}
            </span>
            <span className="tk-stepper__label">
              {t(`tickets.stage.${step}`)}
              <span className="tk-visually-hidden">
                {' — '}
                {t(STATE_LABEL[state])}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default OrderStepper;
