/**
 * Testul de umor (TZ secț. 2.7) pentru Mini App.
 *
 * PORT DOM al lui `mobile/app/humor.tsx`: carduri de glume una câte una,
 * „amuzant" / „nu prea", iar la ultimul card se salvează profilul.
 *
 * DIFERENȚA FAȚĂ DE MOBIL, intenționată: aici NU există poarta obligatorie
 * (`humorGate`, `router.dismissTo`, `useAuthStore`). În aplicația nativă testul
 * e un zid prin care userul trebuie să treacă după anketă; în Mini App e un
 * ecran deschis din meniu, deci nu are pe cine bloca și nu are unde „să
 * continue oricum". Din același motiv butonul final face `navigate(-1)`:
 * întoarce exact de unde a venit userul, fără să inventeze o rută nouă.
 *
 * COMUTAT DIN PANOU: testul poate fi oprit de admin (`GET /humor/config`).
 * Oprit → ecranul spune asta și nu mai încarcă glumele (linkurile vechi spre
 * `/humor` nu duc într-un test pe care nimeni nu-l mai cere). Pornit → întâi un
 * ecran de INTRODUCERE (de ce facem testul, cât durează, cine vede răspunsurile),
 * cu text editabil din panou și fallback în catalogul `screens:humorIntro`.
 *
 * Limba: DOUĂ surse diferite, ambele cu fallback pe română.
 *  - textul glumei vine de la server (`text_ro/ru/uk/en`) → `cardText`;
 *  - restul ecranului (titlu, butoane, erori) vine din catalogul `humor` → `t()`.
 * Glumele NU se pun în cataloage: sunt conținut de la server.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { cardText } from '@mobile/features/humor/cardText';

import { DEFAULT_LANGUAGE, normalizeLanguage } from '@/i18n/config';

import { HUMOR_CONFIG_QUERY_KEY, fetchHumorConfig, fetchQuiz, submitQuiz } from './humorApi';
import type { HumorAnswer, HumorCard, HumorConfig, HumorProfile } from './humorApi';

import './humor.css';

/**
 * Cheia sub care ecranele interesate de profilul de umor îl citesc
 * (`GET /humor/me`). O ținem aici, lângă singurul loc care o SCRIE, ca
 * rezultatul proaspăt al testului să nu ajungă din greșeală sub altă cheie.
 */
export const HUMOR_ME_QUERY_KEY = ['humor-me'] as const;

/**
 * Indicatorul de progres, port DOM al lui `ProgressDots` din mobil: puncte, nu
 * o bibliotecă. E DECOR — cititorul de ecran primește textul de progres de
 * dedesubt, deci punctele sunt ascunse pentru el (`aria-hidden`), altfel ar citi
 * șapte elemente goale.
 */
function ProgressDots({ total, current }: { total: number; current: number }): ReactElement {
  return (
    <div className="hm-dots" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={
            i === current ? 'hm-dot hm-dot--current' : i < current ? 'hm-dot hm-dot--done' : 'hm-dot'
          }
        />
      ))}
    </div>
  );
}

export function HumorScreen(): ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation('humor');
  const { t: ts } = useTranslation('screens');
  // Limba glumei se ia din i18n, nu din vreun store propriu: ecranul trebuie să
  // arate exact limba în care e scris restul interfeței.
  const language = normalizeLanguage(i18n.language) ?? DEFAULT_LANGUAGE;

  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<HumorAnswer[]>([]);

  const configQuery = useQuery<HumorConfig>({
    queryKey: [...HUMOR_CONFIG_QUERY_KEY],
    queryFn: fetchHumorConfig,
  });
  const enabled = configQuery.data?.enabled === true;

  const { data, isPending, isError, refetch, isFetching } = useQuery<HumorCard[]>({
    queryKey: ['humor-quiz'],
    queryFn: fetchQuiz,
    // Glumele se cer doar când testul e PORNIT: oprit, nu au ce căuta pe ecran.
    enabled,
  });

  const submitMutation = useMutation<HumorProfile, Error, HumorAnswer[]>({
    mutationFn: (payload) => submitQuiz(payload),
    onSuccess: (profile) => {
      // Punem rezultatul proaspăt în cache: cine întreabă imediat după test
      // „ce profil de umor am?" primește răspunsul fără încă o cerere de rețea.
      queryClient.setQueryData([...HUMOR_ME_QUERY_KEY], profile);
    },
  });

  if (configQuery.isPending) {
    return (
      <div className="hm-state">
        <div className="spinner" role="status" aria-label={t('quiz.title')} />
      </div>
    );
  }

  if (configQuery.isError) {
    return (
      <div className="hm-state" data-testid="humor-error">
        <p className="error-text">{t('quiz.loadError')}</p>
        <button
          type="button"
          className="button"
          data-testid="humor-load-retry"
          disabled={configQuery.isFetching}
          onClick={() => void configQuery.refetch()}
        >
          {t('quiz.retry')}
        </button>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="hm-state" data-testid="humor-disabled">
        <p className="title hm-saved">{ts('humorIntro.disabledTitle')}</p>
        <p className="body-text hm-intro__body">{ts('humorIntro.disabledBody')}</p>
        <button type="button" className="button" onClick={() => void navigate(-1)}>
          {ts('humorIntro.back')}
        </button>
      </div>
    );
  }

  // Ecranul de introducere: userul află DE CE i se cere testul înainte de prima
  // glumă. Textul vine din panou (`intro_<limbă>`), cu fallback pe catalog.
  if (!started) {
    const config = configQuery.data;
    // Fără fallback pe româna din panou: un text gol într-o limbă cade pe
    // explicația implicită ÎN LIMBA userului, nu pe o limbă pe care n-o vorbește.
    const intro = config?.[`intro_${language}` as const]?.trim() || ts('humorIntro.body');
    return (
      <div className="hm-screen hm-intro" data-testid="humor-intro">
        <p className="hm-emoji" aria-hidden="true">
          🎭
        </p>
        <h1 className="title">{ts('humorIntro.title')}</h1>
        <div className="hm-intro__body" data-testid="humor-intro-text">
          {intro.split(/\n{2,}/).map((paragraph, i) => (
            <p key={i} className="body-text">
              {paragraph}
            </p>
          ))}
        </div>
        <ul className="hm-intro__facts">
          <li>{ts('humorIntro.factDuration')}</li>
          <li>{ts('humorIntro.factNoWrong')}</li>
          <li>{ts('humorIntro.factPrivate')}</li>
        </ul>
        <div className="hm-actions">
          <button
            type="button"
            className="button"
            data-testid="humor-start"
            onClick={() => setStarted(true)}
          >
            {ts('humorIntro.start')}
          </button>
        </div>
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="hm-state">
        <div className="spinner" role="status" aria-label={t('quiz.title')} />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="hm-state" data-testid="humor-error">
        <p className="error-text">{t('quiz.loadError')}</p>
        <button
          type="button"
          className="button"
          data-testid="humor-load-retry"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          {t('quiz.retry')}
        </button>
      </div>
    );
  }

  const cards = data;

  if (cards.length === 0) {
    return (
      <div className="hm-state" data-testid="humor-empty">
        <p className="body-text">{t('quiz.empty')}</p>
      </div>
    );
  }

  // Profilul s-a salvat: ecranul de confirmare înlocuiește quiz-ul.
  if (submitMutation.isSuccess) {
    return (
      <div className="hm-state">
        <p className="hm-emoji" aria-hidden="true">
          🎭
        </p>
        <p className="title hm-saved">{t('quiz.saved')}</p>
        <button
          type="button"
          className="button"
          data-testid="humor-done"
          onClick={() => void navigate(-1)}
        >
          {t('quiz.done')}
        </button>
      </div>
    );
  }

  // `noUncheckedIndexedAccess`: indexarea poate întoarce `undefined`. Aici n-ar
  // trebui să se întâmple (indexul e mereu sub lungime), dar o ramură explicită
  // e mai bună decât un `!` care ar arunca un ecran alb dacă ne înșelăm.
  const card = cards[index];
  if (!card) {
    return (
      <div className="hm-state" data-testid="humor-empty">
        <p className="body-text">{t('quiz.empty')}</p>
      </div>
    );
  }

  const answer = (funny: boolean) => {
    const next: HumorAnswer[] = [...answers, { cardId: card.id, funny }];
    // Răspunsul se PĂSTREAZĂ în stare chiar și la ultimul card: dacă salvarea
    // eșuează, butonul de reîncercare retrimite aceeași listă, fără ca userul
    // să reia testul de la capăt.
    setAnswers(next);
    if (index + 1 < cards.length) {
      setIndex(index + 1);
    } else {
      submitMutation.mutate(next);
    }
  };

  let actions: ReactElement;
  if (submitMutation.isPending) {
    actions = <div className="spinner" role="status" aria-label={t('quiz.title')} />;
  } else if (submitMutation.isError) {
    actions = (
      <>
        <p className="error-text">{t('quiz.saveError')}</p>
        <button
          type="button"
          className="button"
          data-testid="humor-retry"
          onClick={() => submitMutation.mutate(answers)}
        >
          {t('quiz.retry')}
        </button>
      </>
    );
  } else {
    actions = (
      <>
        <button
          type="button"
          className="button"
          data-testid="humor-funny"
          onClick={() => answer(true)}
        >
          {t('quiz.funny')}
        </button>
        <button
          type="button"
          className="button button--ghost"
          data-testid="humor-not-funny"
          onClick={() => answer(false)}
        >
          {t('quiz.notFunny')}
        </button>
      </>
    );
  }

  return (
    <div className="hm-screen">
      <h1 className="title">{t('quiz.title')}</h1>

      <div className="hm-progress">
        <ProgressDots total={cards.length} current={index} />
        {/* Punctele singure nu spun nimic unui cititor de ecran (și nici
            ochiului, la șapte carduri) — progresul scris e accesibilitate, nu
            decor. */}
        <p className="caption hm-progress__text" data-testid="humor-progress">
          {t('quiz.progress', { current: index + 1, total: cards.length })}
        </p>
      </div>

      <div className="hm-card-wrap">
        <div className="hm-card">
          <p className="hm-card__emoji" aria-hidden="true">
            😄
          </p>
          <p className="hm-card__text" data-testid="humor-card-text">
            {cardText(card, language)}
          </p>
        </div>
      </div>

      <div className="hm-actions">{actions}</div>
    </div>
  );
}

export default HumorScreen;
