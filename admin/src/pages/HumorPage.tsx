/**
 * Testul de umor: comutatorul global (activ / inactiv), textul ecranului de
 * introducere (ro/ru/en) și glumele (adăugare, editare, activare, ștergere,
 * reordonare).
 *
 * Proprietarul folosește panoul de pe TELEFON, deci glumele sunt o listă de
 * carduri (nu un tabel cu scroll orizontal), iar reordonarea e cu butoane
 * sus/jos (nu drag & drop, care pe ecran tactil se bate cu scroll-ul).
 *
 * Toate regulile sunt verificate și pe server (texte ne-goale, plafoane,
 * minimum de glume active ca testul să poată fi pornit); panoul le repetă doar
 * ca adminul să afle înainte de a apăsa „Salvează".
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';

import {
  HUMOR_INTRO_MAX,
  HUMOR_TEXT_MAX,
  createHumorQuestion,
  deleteHumorQuestion,
  fetchHumorQuestions,
  fetchHumorSettings,
  reorderHumorQuestions,
  updateHumorQuestion,
  updateHumorSettings,
  type HumorQuestion,
  type HumorQuestionInput,
  type HumorSettings,
} from '../api/humor';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Select,
  TextArea,
} from '../components/ui';
import { useMessages } from '../i18n/LanguageContext';
import { humorMessages } from '../i18n/messages/humor';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';

import './HumorPage.css';

type HumorMessages = (typeof humorMessages)['ro'];

const LANGS = ['ro', 'ru', 'en'] as const;
type Lang = (typeof LANGS)[number];

const SETTINGS_KEY = ['humor-settings'] as const;
const QUESTIONS_KEY = ['humor-questions'] as const;

function typeLabel(m: HumorMessages, type: string): string {
  return m.types[type] ?? type;
}

/* --------------------------- Comutatorul global --------------------------- */

function StatusCard({ settings }: { settings: HumorSettings }): JSX.Element {
  const m = useMessages(humorMessages);
  const queryClient = useQueryClient();
  const belowMin = settings.active_questions < settings.min_active_questions;

  const mutation = useMutation({
    mutationFn: (enabled: boolean) =>
      updateHumorSettings({
        enabled,
        intro_ro: settings.intro_ro,
        intro_ru: settings.intro_ru,
        intro_en: settings.intro_en,
      }),
    onSuccess: (next) => queryClient.setQueryData([...SETTINGS_KEY], next),
  });

  const on = settings.enabled;
  // Pornirea e blocată sub prag; oprirea e permisă oricând.
  const disabled = mutation.isPending || (!on && belowMin);

  return (
    <section className={on ? 'card humor-status humor-status--on' : 'card humor-status'}>
      <div className="humor-status__row">
        <div className="humor-status__text">
          <span className="humor-status__label">{m.statusTitle}</span>
          <span className="humor-status__state" data-testid="humor-status">
            <Badge tone={on ? 'success' : 'neutral'}>{on ? m.statusOn : m.statusOff}</Badge>
          </span>
        </div>
        <label className="humor-switch">
          <input
            type="checkbox"
            role="switch"
            aria-label={m.toggleLabel}
            checked={on}
            disabled={disabled}
            onChange={(e) => mutation.mutate(e.target.checked)}
          />
          <span className="humor-switch__track" aria-hidden="true">
            <span className="humor-switch__thumb" />
          </span>
        </label>
      </div>
      <p className="humor-status__explain">{on ? m.onExplain : m.offExplain}</p>
      <p className="muted humor-status__meta">
        {m.activeCount(settings.active_questions, settings.min_active_questions)}
      </p>
      {!on && belowMin ? (
        <div className="alert alert--warning">{m.belowMin(settings.min_active_questions)}</div>
      ) : null}
      {mutation.isPending ? <p className="field__hint">{m.toggling}</p> : null}
      {mutation.isError ? (
        <div className="alert" role="alert">
          {errorMessage(mutation.error)}
        </div>
      ) : null}
      {settings.updated_at ? (
        <p className="muted humor-status__meta">{m.lastChange(formatDateTime(settings.updated_at))}</p>
      ) : null}
    </section>
  );
}

/* --------------------------- Textul de introducere --------------------------- */

type IntroForm = Record<Lang, string>;

function introFrom(settings: HumorSettings): IntroForm {
  return { ro: settings.intro_ro, ru: settings.intro_ru, en: settings.intro_en };
}

function IntroCard({ settings }: { settings: HumorSettings }): JSX.Element {
  const m = useMessages(humorMessages);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<IntroForm>(() => introFrom(settings));
  const [saved, setSaved] = useState(false);

  // Serverul e sursa adevărului: după o salvare (sau comutare) reluăm valorile.
  useEffect(() => {
    setForm(introFrom(settings));
  }, [settings]);

  const dirty = LANGS.some((lang) => form[lang] !== introFrom(settings)[lang]);

  const mutation = useMutation({
    mutationFn: () =>
      updateHumorSettings({
        enabled: settings.enabled,
        intro_ro: form.ro.trim(),
        intro_ru: form.ru.trim(),
        intro_en: form.en.trim(),
      }),
    onSuccess: (next) => {
      queryClient.setQueryData([...SETTINGS_KEY], next);
      setSaved(true);
    },
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!dirty || mutation.isPending) return;
    setSaved(false);
    mutation.mutate();
  };

  return (
    <Card title={m.introTitle}>
      <form className="humor-form" onSubmit={submit}>
        <p className="field__hint" style={{ margin: 0 }}>
          {m.introHint}
        </p>
        {LANGS.map((lang) => (
          <Field key={lang} label={m.introLabel(lang.toUpperCase())} htmlFor={`humor-intro-${lang}`}>
            <TextArea
              id={`humor-intro-${lang}`}
              rows={5}
              value={form[lang]}
              maxLength={HUMOR_INTRO_MAX}
              onChange={(e) => {
                setSaved(false);
                setForm((f) => ({ ...f, [lang]: e.target.value }));
              }}
            />
            <span className="field__hint humor-counter">
              {m.counter(form[lang].length, HUMOR_INTRO_MAX)}
            </span>
          </Field>
        ))}
        {saved && !dirty ? <div className="alert alert--success">{m.introSaved}</div> : null}
        {mutation.isError ? (
          <div className="alert" role="alert">
            {errorMessage(mutation.error)}
          </div>
        ) : null}
        <div className="humor-form__actions">
          <Button
            variant="ghost"
            disabled={!dirty || mutation.isPending}
            onClick={() => setForm(introFrom(settings))}
          >
            {m.discard}
          </Button>
          <Button type="submit" variant="primary" disabled={!dirty || mutation.isPending}>
            {mutation.isPending ? m.introSaving : m.introSave}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* ------------------------------ Formularul glumei ------------------------------ */

const EMPTY_QUESTION: HumorQuestionInput = {
  humor_type: 'sarcasm',
  text_ro: '',
  text_ru: '',
  text_en: '',
  active: true,
};

function QuestionForm({
  question,
  humorTypes,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  question: HumorQuestion | null;
  humorTypes: string[];
  busy: boolean;
  error: string | null;
  onSubmit: (input: HumorQuestionInput) => void;
  onCancel: () => void;
}): JSX.Element {
  const m = useMessages(humorMessages);
  const [form, setForm] = useState<HumorQuestionInput>(() =>
    question
      ? {
          humor_type: question.humor_type,
          text_ro: question.text_ro,
          text_ru: question.text_ru,
          text_en: question.text_en,
          active: question.active,
        }
      : { ...EMPTY_QUESTION, humor_type: humorTypes[0] ?? EMPTY_QUESTION.humor_type },
  );

  const textKey = (lang: Lang): 'text_ro' | 'text_ru' | 'text_en' => `text_${lang}`;
  const valid = LANGS.every((lang) => form[textKey(lang)].trim().length > 0);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!valid || busy) return;
    onSubmit({
      ...form,
      text_ro: form.text_ro.trim(),
      text_ru: form.text_ru.trim(),
      text_en: form.text_en.trim(),
    });
  };

  return (
    <Modal title={question ? m.editTitle : m.newTitle} onClose={onCancel} wide>
      <form className="modal__body" onSubmit={submit}>
        <Field label={m.typeLabel} htmlFor="humor-q-type">
          <Select
            id="humor-q-type"
            value={form.humor_type}
            onChange={(e) => setForm((f) => ({ ...f, humor_type: e.target.value }))}
          >
            {humorTypes.map((type) => (
              <option key={type} value={type}>
                {typeLabel(m, type)}
              </option>
            ))}
          </Select>
          <span className="field__hint">{m.typeHint}</span>
        </Field>

        {LANGS.map((lang) => {
          const key = textKey(lang);
          return (
            <Field key={lang} label={m.textLabel(lang.toUpperCase())} htmlFor={`humor-q-${lang}`}>
              <TextArea
                id={`humor-q-${lang}`}
                rows={3}
                value={form[key]}
                maxLength={HUMOR_TEXT_MAX}
                required
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              />
              <span className="field__hint humor-counter">
                {m.counter(form[key].length, HUMOR_TEXT_MAX)}
              </span>
            </Field>
          );
        })}

        <label className="field field--check" htmlFor="humor-q-active">
          <input
            id="humor-q-active"
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
          />
          <span className="field__label" style={{ margin: 0 }}>
            {m.activeLabel}
          </span>
        </label>

        {!valid ? <p className="field__hint">{m.textRequired}</p> : null}
        {error ? <div className="alert">{error}</div> : null}

        <div className="modal__actions">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {m.cancel}
          </Button>
          <Button type="submit" variant="primary" disabled={!valid || busy}>
            {busy ? m.saving : m.save}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------ Lista de glume ------------------------------ */

function QuestionsCard({ settings }: { settings: HumorSettings }): JSX.Element {
  const m = useMessages(humorMessages);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<HumorQuestion | 'new' | null>(null);
  const [deleting, setDeleting] = useState<HumorQuestion | null>(null);

  const questionsQuery = useQuery({ queryKey: [...QUESTIONS_KEY], queryFn: fetchHumorQuestions });

  // Orice schimbare de glume poate muta contorul de glume active din cardul de stare.
  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [...QUESTIONS_KEY] }),
      queryClient.invalidateQueries({ queryKey: [...SETTINGS_KEY] }),
    ]);
  };

  const saveMutation = useMutation({
    mutationFn: (input: HumorQuestionInput) =>
      editing && editing !== 'new'
        ? updateHumorQuestion(editing.id, input)
        : createHumorQuestion(input),
    onSuccess: async () => {
      setEditing(null);
      await refresh();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (q: HumorQuestion) => updateHumorQuestion(q.id, { active: !q.active }),
    onSuccess: refresh,
  });

  const deleteMutation = useMutation({
    mutationFn: (q: HumorQuestion) => deleteHumorQuestion(q.id),
    onSuccess: async () => {
      setDeleting(null);
      await refresh();
    },
  });

  const reorderMutation = useMutation({
    mutationFn: reorderHumorQuestions,
    onSuccess: (next) => queryClient.setQueryData([...QUESTIONS_KEY], next),
  });

  if (questionsQuery.isPending) return <LoadingState label={m.loading} />;
  if (questionsQuery.isError) {
    return (
      <ErrorState
        message={errorMessage(questionsQuery.error)}
        onRetry={() => void questionsQuery.refetch()}
      />
    );
  }

  const questions = questionsQuery.data;
  const activeCount = questions.filter((q) => q.active).length;

  const move = (index: number, delta: -1 | 1): void => {
    const target = index + delta;
    if (target < 0 || target >= questions.length) return;
    const ids = questions.map((q) => q.id);
    const [moved] = ids.splice(index, 1);
    if (moved === undefined) return;
    ids.splice(target, 0, moved);
    reorderMutation.mutate(ids);
  };

  const rowError = toggleMutation.isError
    ? errorMessage(toggleMutation.error)
    : reorderMutation.isError
      ? errorMessage(reorderMutation.error)
      : null;

  return (
    <Card
      title={m.questionsTitle(activeCount, questions.length)}
      actions={
        <Button variant="primary" small onClick={() => setEditing('new')}>
          {m.addQuestion}
        </Button>
      }
    >
      {rowError ? (
        <div className="alert" role="alert" style={{ marginBottom: 'var(--space-3)' }}>
          {rowError}
        </div>
      ) : null}

      {questions.length === 0 ? (
        <EmptyState title={m.emptyTitle} hint={m.emptyHint} />
      ) : (
        <ol className="humor-list">
          {questions.map((q, index) => (
            <li
              key={q.id}
              className={q.active ? 'humor-item' : 'humor-item humor-item--inactive'}
              data-testid="humor-question"
            >
              <div className="humor-item__head">
                <span className="humor-item__pos mono">{m.position(index + 1)}</span>
                <Badge tone="accent">{typeLabel(m, q.humor_type)}</Badge>
                <Badge tone={q.active ? 'success' : 'neutral'}>
                  {q.active ? m.active : m.inactive}
                </Badge>
              </div>
              <p className="humor-item__text">{q.text_ro}</p>
              <p className="humor-item__sub muted">
                <span className="mono">RU</span> {q.text_ru}
              </p>
              <p className="humor-item__sub muted">
                <span className="mono">EN</span> {q.text_en}
              </p>
              <div className="humor-item__actions">
                <Button
                  small
                  aria-label={m.moveUp}
                  title={m.moveUp}
                  disabled={index === 0 || reorderMutation.isPending}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </Button>
                <Button
                  small
                  aria-label={m.moveDown}
                  title={m.moveDown}
                  disabled={index === questions.length - 1 || reorderMutation.isPending}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </Button>
                <span className="humor-item__spacer" />
                <Button small onClick={() => setEditing(q)}>
                  {m.edit}
                </Button>
                <Button
                  small
                  disabled={toggleMutation.isPending}
                  onClick={() => toggleMutation.mutate(q)}
                >
                  {q.active ? m.deactivate : m.activate}
                </Button>
                <Button small variant="danger" onClick={() => setDeleting(q)}>
                  {m.delete}
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}

      {editing ? (
        <QuestionForm
          question={editing === 'new' ? null : editing}
          humorTypes={settings.humor_types}
          busy={saveMutation.isPending}
          error={saveMutation.isError ? errorMessage(saveMutation.error) : null}
          onSubmit={(input) => saveMutation.mutate(input)}
          onCancel={() => {
            saveMutation.reset();
            setEditing(null);
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={m.deleteTitle}
          message={m.deleteMessage}
          confirmLabel={m.deleteConfirm}
          busy={deleteMutation.isPending}
          errorMessage={deleteMutation.isError ? errorMessage(deleteMutation.error) : null}
          onConfirm={() => deleteMutation.mutate(deleting)}
          onCancel={() => {
            deleteMutation.reset();
            setDeleting(null);
          }}
        />
      ) : null}
    </Card>
  );
}

/* ---------------------------------- Pagina ---------------------------------- */

export function HumorPage(): JSX.Element {
  const m = useMessages(humorMessages);
  const settingsQuery = useQuery({ queryKey: [...SETTINGS_KEY], queryFn: fetchHumorSettings });

  if (settingsQuery.isPending) return <LoadingState label={m.loading} />;
  if (settingsQuery.isError) {
    return (
      <ErrorState
        message={errorMessage(settingsQuery.error)}
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  }

  const settings = settingsQuery.data;
  return (
    <div className="humor-page">
      <StatusCard settings={settings} />
      <QuestionsCard settings={settings} />
      <IntroCard settings={settings} />
    </div>
  );
}
