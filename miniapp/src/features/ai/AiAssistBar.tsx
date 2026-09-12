/**
 * Bara AI a conversației: sugestiile de mesaj + scorul de chimie explicat.
 *
 * REGULA CARE NU SE NEGOCIAZĂ: sugestia NU pleacă niciodată singură. Apăsarea pe
 * „Pune în mesaj" o scrie în câmpul de scriere și atât — trimiterea rămâne
 * apăsarea pe „Trimite", exact ca pentru un text scris de mână. Un mesaj trimis
 * automat ar vorbi în numele utilizatorului, cu un text pe care nu l-a citit.
 * De aceea componentul primește `onInsert`, nu `onSend`: nici nu are cum.
 *
 * CÂND NU EXISTĂ: dacă funcția e oprită din setări, `AiAssistBar` întoarce
 * `null` înainte de a randa orice, iar hook-urile de date de mai jos nu pornesc
 * nimic de la sine (mutația așteaptă un clic, interogarea e `enabled: false`).
 * Nu e doar un buton ascuns — nu pleacă nicio cerere spre `/ai`.
 *
 * DE CE SCORUL DE CHIMIE E AICI, și nu pe cardul din feed:
 *  - `GET /ai/chemistry/{user_id}` întoarce ca `score` exact scorul DETERMINIST
 *    de compatibilitate (`backend/app/services/compatibility.py`) — același
 *    număr pe care antetul acestei conversații îl afișează deja în badge. Partea
 *    adăugată de AI e EXPLICAȚIA. Locul firesc al unei explicații e lângă cifra
 *    pe care o explică, iar cifra e deja aici;
 *  - pe cardul din feed nu există încă o conversație, deci explicația ar fi
 *    despre două profiluri, nu despre o dinamică; iar un al doilea procent lângă
 *    badge-ul de compatibilitate ar fi citit ca o contradicție;
 *  - `features/feed/` nu e al acestui agent — dacă produsul decide altfel,
 *    componentul se mută fără să-și schimbe stratul de date.
 *
 * Fără `alert()` / `confirm()`: blochează WebView-ul Telegram.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { fetchChatHint, fetchChemistry, type ChemistryResult } from './aiApi';
import { aiErrorKey, toAiError, type AiErrorKind } from './aiErrors';
import { useAiEnabled } from './aiSettings';

import './ai.css';

/**
 * Cauzele pentru care o reîncercare imediată nu are cum să ajute: starea e pe
 * cont sau pe server, nu în cerere. Un buton „încearcă din nou" acolo ar fi o
 * minciună politicoasă.
 */
const PERMANENT: AiErrorKind[] = ['disabled', 'not_configured', 'not_found', 'no_history'];

/** Mesajul scurt al unei erori, în interiorul panoului. Fără ecran plin. */
function AiInlineError({
  kind,
  onRetry,
  testId,
}: {
  kind: AiErrorKind;
  onRetry?: () => void;
  testId: string;
}) {
  const { t } = useTranslation(['miniapp']);
  const retryable = !PERMANENT.includes(kind) && !!onRetry;

  return (
    <div className="ai-panel__error" data-testid={testId} data-kind={kind}>
      <p className="error-text" role="alert">
        {t(aiErrorKey(kind))}
      </p>
      {retryable ? (
        <button
          type="button"
          className="button button--ghost"
          data-testid={`${testId}-retry`}
          onClick={onRetry}
        >
          {t('miniapp:ai.retry')}
        </button>
      ) : null}
    </div>
  );
}

/** Rotița mică + textul ei, pentru o stare din interiorul unui panou. */
function AiLoading({ label }: { label: string }) {
  return (
    <div className="ai-inline">
      <span className="spinner spinner--sm" role="status" aria-label={label} />
      <span className="caption">{label}</span>
    </div>
  );
}

export interface AiAssistBarProps {
  chatId: string;
  /** Celălalt participant. Gol = încă nu îl cunoaștem → chimia rămâne blocată. */
  otherUserId: string;
  /** Pune textul în câmpul de scriere. NU îl trimite — vezi nota de sus. */
  onInsert: (text: string) => void;
}

export function AiAssistBar({ chatId, otherUserId, onInsert }: AiAssistBarProps) {
  const { t } = useTranslation(['miniapp']);
  const { enabled } = useAiEnabled();

  const [hintOpen, setHintOpen] = useState(false);
  const [chemistryOpen, setChemistryOpen] = useState(false);

  /**
   * Sugestiile sunt o MUTAȚIE, nu o interogare: pleacă doar la apăsarea
   * utilizatorului (e un POST care costă bani la furnizor), iar „Altă sugestie"
   * trebuie să însemne o cerere nouă, nu un cache reîncălzit.
   */
  const hint = useMutation({ mutationFn: () => fetchChatHint(chatId) });

  const chemistry = useQuery<ChemistryResult>({
    queryKey: ['ai', 'chemistry', otherUserId],
    queryFn: () => fetchChemistry(otherUserId),
    // Nicio cerere până când utilizatorul nu deschide panoul EL.
    enabled: chemistryOpen && !!otherUserId,
    retry: false,
    // Scorul costă un apel la furnizor; nu-l recerem la fiecare deschidere.
    staleTime: 5 * 60 * 1000,
  });

  // Poarta care garantează „nicio cerere când funcția e oprită".
  if (!enabled) return null;

  return (
    <div className="ai-bar" data-testid="ai-bar">
      <div className="ai-bar__actions">
        <button
          type="button"
          className="button button--ghost ai-bar__button"
          data-testid="ai-suggest"
          disabled={hint.isPending}
          onClick={() => {
            setHintOpen(true);
            hint.mutate();
          }}
        >
          {hint.isPending ? t('miniapp:ai.suggestion.loading') : t('miniapp:ai.suggestion.ask')}
        </button>

        <button
          type="button"
          className="button button--ghost ai-bar__button"
          data-testid="ai-chemistry-open"
          disabled={!otherUserId}
          aria-expanded={chemistryOpen}
          onClick={() => setChemistryOpen((open) => !open)}
        >
          {t('miniapp:ai.chemistry.open')}
        </button>
      </div>

      {/* ── Sugestiile ────────────────────────────────────────────────── */}
      {hintOpen ? (
        <div className="ai-panel" data-testid="ai-suggestion-panel">
          <div className="ai-panel__head">
            <span className="caption">{t('miniapp:ai.suggestion.title')}</span>
            <button
              type="button"
              className="ai-panel__close"
              data-testid="ai-suggestion-close"
              aria-label={t('miniapp:ai.close')}
              onClick={() => setHintOpen(false)}
            >
              ✕
            </button>
          </div>

          {hint.isPending ? (
            <AiLoading label={t('miniapp:ai.suggestion.loading')} />
          ) : hint.isError ? (
            <AiInlineError
              kind={toAiError(hint.error).kind}
              testId="ai-suggestion-error"
              onRetry={() => hint.mutate()}
            />
          ) : hint.data ? (
            <>
              <p className="caption">{t('miniapp:ai.suggestion.note')}</p>

              <ul className="ai-panel__list">
                {hint.data.suggestions.map((text, index) => (
                  // Cheia include indexul: modelul poate întoarce, rar, două
                  // variante identice, iar textul singur n-ar mai fi unic.
                  <li className="ai-suggestion" key={`${index}-${text}`}>
                    <p
                      className="body-text ai-panel__text"
                      data-testid={`ai-suggestion-text-${index}`}
                    >
                      {text}
                    </p>
                    <button
                      type="button"
                      className="button"
                      data-testid={`ai-suggestion-insert-${index}`}
                      onClick={() => {
                        // ATENȚIE: doar în câmp. Nicio trimitere aici, niciodată.
                        onInsert(text);
                        setHintOpen(false);
                      }}
                    >
                      {t('miniapp:ai.suggestion.insert')}
                    </button>
                  </li>
                ))}
              </ul>

              <div className="ai-panel__actions">
                <button
                  type="button"
                  className="button button--ghost"
                  data-testid="ai-suggestion-again"
                  onClick={() => hint.mutate()}
                >
                  {t('miniapp:ai.suggestion.again')}
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {/* ── Scorul de chimie ──────────────────────────────────────────── */}
      {chemistryOpen ? (
        <div className="ai-panel" data-testid="ai-chemistry-panel">
          <div className="ai-panel__head">
            <span className="caption">{t('miniapp:ai.chemistry.title')}</span>
            <button
              type="button"
              className="ai-panel__close"
              data-testid="ai-chemistry-close"
              aria-label={t('miniapp:ai.close')}
              onClick={() => setChemistryOpen(false)}
            >
              ✕
            </button>
          </div>

          {chemistry.isPending ? (
            <AiLoading label={t('miniapp:ai.chemistry.loading')} />
          ) : chemistry.isError ? (
            <AiInlineError
              kind={toAiError(chemistry.error).kind}
              testId="ai-chemistry-error"
              onRetry={() => void chemistry.refetch()}
            />
          ) : (
            <>
              <p className="title ai-panel__score" data-testid="ai-chemistry-score">
                {t('miniapp:ai.chemistry.score', { score: chemistry.data.score })}
              </p>

              {chemistry.data.explanation ? (
                <p className="body-text ai-panel__text" data-testid="ai-chemistry-explanation">
                  {chemistry.data.explanation}
                </p>
              ) : (
                /* Scorul vine chiar și fără AI — e calculul determinist, același
                   cu badge-ul din antet. Lipsește DOAR explicația, și spunem de
                   ce, în loc să lăsăm un panou cu o cifră fără context. */
                <AiInlineError
                  kind={chemistry.data.unavailable ?? 'provider'}
                  testId="ai-chemistry-no-explanation"
                  onRetry={() => void chemistry.refetch()}
                />
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default AiAssistBar;
