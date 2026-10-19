/**
 * Editorul TIPURILOR DE BILET dintr-un eveniment (Early bird / Standard / VIP …).
 *
 * Fiecare tip e un card compact: nume + preț + locuri pe un rând (pe mobil se
 * stivuiesc), descrierea scurtă dedesubt, iar în antet ordinea (sus/jos) și
 * ștergerea. Regulile (max 4, nume unice, plafon ≥ vândute) stau în
 * `lib/eventForm.ts`, oglinda backendului; aici doar le afișăm pe rând.
 *
 * Un tip cu bilete vândute nu se poate scoate din listă (backendul ar refuza
 * cu 409 oricum): butonul de ștergere e dezactivat, cu explicația alături.
 */
import { MAX_TICKET_TIERS } from '../api/types';
import { useLanguage, useMessages } from '../i18n/LanguageContext';
import { eventsMessages } from '../i18n/messages/events';
import {
  EVENT_LIMITS,
  canAddTier,
  moveTier,
  newTierRow,
  validateTiers,
  type TierFormRow,
} from '../lib/eventForm';
import { Button, Field, TextInput } from './ui';
import '../styles/ticketTiers.css';

interface Props {
  rows: TierFormRow[];
  currency: string;
  onChange: (rows: TierFormRow[]) => void;
}

export function TicketTiersEditor({ rows, currency, onChange }: Props): JSX.Element {
  const t = useMessages(eventsMessages).form.tiers;
  const { language } = useLanguage();
  const errors = validateTiers(rows, language);
  const unit = currency.trim() === '' ? 'lei' : currency.trim();

  const update = (index: number, patch: Partial<TierFormRow>): void =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <div className="tiers" data-testid="ticket-tiers">
      <div className="tiers__head">
        <span className="tiers__title">{t.title}</span>
        <span className="tiers__count">
          {rows.length} / {MAX_TICKET_TIERS}
        </span>
      </div>
      <p className="field__hint">{t.hint}</p>

      {rows.length === 0 ? <p className="tiers__empty">{t.empty}</p> : null}

      <ol className="tiers__list">
        {rows.map((row, index) => {
          const rowErrors = errors[index] ?? {};
          const id = `tier-${row.key}`;
          const locked = row.sold > 0;
          return (
            <li key={row.key} className="tier" data-testid="ticket-tier-row">
              <div className="tier__head">
                <span className="tier__index">{t.row(index + 1)}</span>
                {row.id !== null ? (
                  <span className="tier__sold">
                    {t.sold(row.sold, row.capacity.trim() === '' ? null : Number(row.capacity))}
                  </span>
                ) : null}
                <div className="tier__actions">
                  <Button
                    small
                    aria-label={t.moveUp}
                    title={t.moveUp}
                    disabled={index === 0}
                    onClick={() => onChange(moveTier(rows, index, -1))}
                  >
                    ↑
                  </Button>
                  <Button
                    small
                    aria-label={t.moveDown}
                    title={t.moveDown}
                    disabled={index === rows.length - 1}
                    onClick={() => onChange(moveTier(rows, index, 1))}
                  >
                    ↓
                  </Button>
                  <Button
                    small
                    variant="danger"
                    aria-label={t.remove}
                    title={locked ? t.removeSoldHint : t.remove}
                    disabled={locked}
                    onClick={() => onChange(rows.filter((_, i) => i !== index))}
                  >
                    ✕
                  </Button>
                </div>
              </div>

              <div className="tier__grid">
                <div className="tier__name">
                  <Field label={t.name} htmlFor={`${id}-name`}>
                    <TextInput
                      id={`${id}-name`}
                      value={row.name}
                      maxLength={EVENT_LIMITS.tierName}
                      placeholder={t.namePlaceholder}
                      aria-invalid={rowErrors.name ? true : undefined}
                      onChange={(e) => update(index, { name: e.target.value })}
                    />
                  </Field>
                  <RowError message={rowErrors.name} />
                </div>
                <div>
                  <Field label={`${t.price} (${unit})`} htmlFor={`${id}-price`}>
                    <TextInput
                      id={`${id}-price`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={row.price}
                      aria-invalid={rowErrors.price ? true : undefined}
                      onChange={(e) => update(index, { price: e.target.value })}
                    />
                  </Field>
                  <RowError message={rowErrors.price} />
                </div>
                <div>
                  <Field label={t.capacity} htmlFor={`${id}-capacity`}>
                    <TextInput
                      id={`${id}-capacity`}
                      type="number"
                      inputMode="numeric"
                      min={Math.max(1, row.sold)}
                      step={1}
                      placeholder={t.capacityPlaceholder}
                      value={row.capacity}
                      aria-invalid={rowErrors.capacity ? true : undefined}
                      onChange={(e) => update(index, { capacity: e.target.value })}
                    />
                  </Field>
                  <RowError message={rowErrors.capacity} />
                </div>
              </div>

              <Field label={t.description} htmlFor={`${id}-description`}>
                <TextInput
                  id={`${id}-description`}
                  value={row.description}
                  maxLength={EVENT_LIMITS.tierDescription}
                  placeholder={t.descriptionPlaceholder}
                  aria-invalid={rowErrors.description ? true : undefined}
                  onChange={(e) => update(index, { description: e.target.value })}
                />
              </Field>
              <RowError message={rowErrors.description} />
              {locked ? <p className="field__hint">{t.removeSoldHint}</p> : null}
            </li>
          );
        })}
      </ol>

      {canAddTier(rows) ? (
        <Button
          small
          className="tiers__add"
          onClick={() => onChange([...rows, newTierRow()])}
          data-testid="ticket-tier-add"
        >
          + {t.add}
        </Button>
      ) : (
        <p className="field__hint">{t.limit(MAX_TICKET_TIERS)}</p>
      )}
    </div>
  );
}

function RowError({ message }: { message?: string }): JSX.Element | null {
  if (!message) return null;
  return (
    <p className="field__error" role="alert">
      {message}
    </p>
  );
}
