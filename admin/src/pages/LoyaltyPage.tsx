/**
 * Trepte de fidelitate: pragurile, procentele și plafonul total.
 *
 * CE FACE ECRANUL ĂSTA POSIBIL: pragurile stau într-un rând din baza de date
 * (`loyalty_settings`), tocmai ca o schimbare de marketing („de la 3 vizite dai
 * 5%") să fie un click, nu un deploy. Până la ecranul ăsta, ruta exista, dar
 * nimeni nu o putea folosi — adică pragurile erau, în practică, tot în cod.
 *
 * Trei decizii care se văd în cod:
 *
 * 1. VALIDAREA e oglinda backendului și stă în `lib/loyaltyForm.ts`. Blochează
 *    AICI exact două lucruri pe care backendul le-ar accepta cu 200, dar le-ar
 *    schimba tăcut: pragurile neordonate (le reordonează) și codurile duplicate
 *    (le ȘTERGE). Restul (0..100, 1..10000, max 10 trepte) e 422 pe server.
 * 2. CONSECINȚA se arată înainte de salvare: ce treaptă apare, ce treaptă
 *    dispare și CE INTERVAL de ștampile câștigă sau pierde treapta. Numărul de
 *    utilizatori afectați NU se poate afișa: backendul nu expune nicăieri
 *    distribuția ștampilelor (nici `/admin/stats`, nici `/admin/users`). Se
 *    spune pe față în ecran, nu se inventează o cifră.
 * 3. SCARA SE TRIMITE ÎNTREAGĂ (PUT), deci butonul „Salvează" scrie tot ce e în
 *    formular — inclusiv o listă goală, care înseamnă explicit „program oprit".
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { fetchLoyaltyTiers, updateLoyaltyTiers } from '../api/admin';
import type { LoyaltyTiers } from '../api/types';
import {
  Button,
  Card,
  ErrorState,
  Field,
  LoadingState,
  TextInput,
} from '../components/ui';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import {
  EMPTY_TIER_ROW,
  TIER_LIMITS,
  hasTierErrors,
  tierChanges,
  tiersToForm,
  tiersWarnings,
  toTiersPayload,
  validateTiers,
  type TierRow,
  type TiersFormState,
} from '../lib/loyaltyForm';

/** Mesajul de eroare al unui câmp, sub input (același tipar ca la evenimente). */
function FieldError({ message }: { message?: string }): JSX.Element | null {
  if (!message) return null;
  return (
    <p className="field__error" role="alert">
      {message}
    </p>
  );
}

export function LoyaltyPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<TiersFormState | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['loyalty-tiers'],
    queryFn: fetchLoyaltyTiers,
    // Fără reîncărcare la revenirea în fereastră: ar rescrie formularul pe care
    // adminul tocmai îl completa (`useEffect`-ul de mai jos îl resincronizează).
    refetchOnWindowFocus: false,
  });

  // Formularul pornește din datele serverului și se resincronizează după salvare.
  useEffect(() => {
    if (query.data) setForm(tiersToForm(query.data));
  }, [query.data]);

  const save = useMutation({
    mutationFn: (state: TiersFormState) => updateLoyaltyTiers(toTiersPayload(state)),
    onSuccess: (data: LoyaltyTiers) => {
      setFormError(null);
      setSaved(data.updated_at);
      queryClient.setQueryData(['loyalty-tiers'], data);
    },
    onError: (error: unknown) => {
      setSaved(null);
      setFormError(errorMessage(error));
    },
  });

  if (query.isPending) return <LoadingState label="Se încarcă treptele…" />;
  if (query.isError) {
    return <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  }
  if (form === null) return <LoadingState label="Se încarcă treptele…" />;

  const errors = validateTiers(form);
  const invalid = hasTierErrors(errors);
  const warnings = tiersWarnings(form);
  const changes = tierChanges(query.data, form);
  const dirty =
    query.data !== undefined &&
    JSON.stringify(form) !== JSON.stringify(tiersToForm(query.data));

  const setRow = (index: number, key: keyof TierRow, value: string): void => {
    setSaved(null);
    setForm((current) =>
      current === null
        ? current
        : {
            ...current,
            tiers: current.tiers.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
          },
    );
  };

  const addRow = (): void => {
    setSaved(null);
    setForm((current) =>
      current === null ? current : { ...current, tiers: [...current.tiers, { ...EMPTY_TIER_ROW }] },
    );
  };

  const removeRow = (index: number): void => {
    setSaved(null);
    setForm((current) =>
      current === null
        ? current
        : { ...current, tiers: current.tiers.filter((_, i) => i !== index) },
    );
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (invalid || save.isPending) return;
    save.mutate(form);
  };

  return (
    <form onSubmit={submit}>
      <Card
        title="Program de fidelitate"
        actions={
          <Link className="btn btn--ghost btn--sm" to="/invites">
            Invitații speciale
          </Link>
        }
      >
        <p className="field__hint">
          Treapta unui utilizator vine din numărul de EVENIMENTE DISTINCTE la care are
          check-in confirmat (ștampile Flirt Passport). Fiecare treaptă dă un procent de
          reducere la biletul online; la un bilet se aplică CEA MAI MARE reducere dintre
          treaptă, promo-ul evenimentului și invitație — nu se cumulează — iar rezultatul
          se taie la plafonul de mai jos.
        </p>
        <p className="muted">
          {`Ultima modificare: ${formatDateTime(query.data?.updated_at ?? null)}`}
        </p>

        <div style={{ maxWidth: 260 }}>
          <Field label="Plafon total de reducere (%)" htmlFor="loyalty-cap">
            <TextInput
              id="loyalty-cap"
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              step={1}
              value={form.max_total_discount_percent}
              aria-invalid={errors.cap ? true : undefined}
              onChange={(event) => {
                setSaved(null);
                setForm((current) =>
                  current === null
                    ? current
                    : { ...current, max_total_discount_percent: event.target.value },
                );
              }}
            />
          </Field>
          <FieldError message={errors.cap} />
        </div>
      </Card>

      <Card
        title={`Trepte (${form.tiers.length}/${TIER_LIMITS.count})`}
        actions={
          <Button
            small
            onClick={addRow}
            disabled={form.tiers.length >= TIER_LIMITS.count}
          >
            Adaugă treaptă
          </Button>
        }
      >
        {form.tiers.length === 0 ? (
          <p className="muted" data-testid="tiers-empty">
            Nicio treaptă configurată — programul de fidelitate este oprit.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Cod</th>
                  <th>Nume</th>
                  <th>De la câte ștampile</th>
                  <th>Reducere (%)</th>
                  <th aria-label="Acțiuni" />
                </tr>
              </thead>
              <tbody>
                {form.tiers.map((row, index) => {
                  const rowErrors = errors.rows[index] ?? {};
                  const position = index + 1;
                  return (
                    <tr key={`tier-${index}`}>
                      <td className="mono">{position}</td>
                      <td>
                        <TextInput
                          aria-label={`Cod treapta ${position}`}
                          value={row.code}
                          maxLength={TIER_LIMITS.code}
                          aria-invalid={rowErrors.code ? true : undefined}
                          onChange={(event) => setRow(index, 'code', event.target.value)}
                        />
                        <FieldError message={rowErrors.code} />
                      </td>
                      <td>
                        <TextInput
                          aria-label={`Nume treapta ${position}`}
                          value={row.name}
                          maxLength={TIER_LIMITS.name}
                          aria-invalid={rowErrors.name ? true : undefined}
                          onChange={(event) => setRow(index, 'name', event.target.value)}
                        />
                        <FieldError message={rowErrors.name} />
                      </td>
                      <td>
                        <TextInput
                          aria-label={`Prag ștampile treapta ${position}`}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={TIER_LIMITS.minStamps}
                          step={1}
                          value={row.min_stamps}
                          aria-invalid={rowErrors.min_stamps ? true : undefined}
                          onChange={(event) => setRow(index, 'min_stamps', event.target.value)}
                        />
                        <FieldError message={rowErrors.min_stamps} />
                      </td>
                      <td>
                        <TextInput
                          aria-label={`Reducere treapta ${position}`}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={100}
                          step={1}
                          value={row.discount_percent}
                          aria-invalid={rowErrors.discount_percent ? true : undefined}
                          onChange={(event) =>
                            setRow(index, 'discount_percent', event.target.value)
                          }
                        />
                        <FieldError message={rowErrors.discount_percent} />
                      </td>
                      <td>
                        <div className="table__actions">
                          <Button
                            small
                            variant="danger"
                            onClick={() => removeRow(index)}
                            aria-label={`Șterge treapta ${position}`}
                          >
                            Șterge
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <FieldError message={errors.list} />

        {changes.length > 0 ? (
          <div className="alert alert--warning" data-testid="tiers-changes">
            <strong>Ce se schimbă pentru utilizatori:</strong>
            <ul className="alert__list">
              {changes.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="muted" style={{ margin: 0 }}>
              Câți utilizatori sunt exact în intervalele de mai sus nu se poate afișa:
              backendul nu expune distribuția ștampilelor pe utilizatori.
            </p>
          </div>
        ) : null}

        {warnings.length > 0 ? (
          <div className="alert alert--warning" data-testid="tiers-warnings">
            <strong>Se poate salva, dar:</strong>
            <ul className="alert__list">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {formError ? <div className="alert">{formError}</div> : null}
        {saved !== null ? (
          <div className="alert alert--success" data-testid="tiers-saved">
            {`Treptele au fost salvate (${formatDateTime(saved)}). Se aplică imediat, fără deploy.`}
          </div>
        ) : null}

        <div className="modal__actions">
          <Button
            variant="ghost"
            disabled={!dirty || save.isPending}
            onClick={() => {
              if (query.data) setForm(tiersToForm(query.data));
              setFormError(null);
              setSaved(null);
            }}
          >
            Renunță la modificări
          </Button>
          <Button type="submit" variant="primary" disabled={invalid || save.isPending}>
            {save.isPending ? 'Se salvează…' : 'Salvează treptele'}
          </Button>
        </div>
      </Card>
    </form>
  );
}
