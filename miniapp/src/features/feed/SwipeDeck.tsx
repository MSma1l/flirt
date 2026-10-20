/**
 * Deck-ul de ankete pentru Mini App — ecranul principal al produsului.
 *
 * REUTILIZAT din aplicația Expo, fără copiere:
 *   - `feedApi.ts`      — cererile /feed, /feed/swipe, /feed/undo (prin alias-ul
 *                         `@/services/api`, care aici duce la clientul web);
 *   - `swipeDirection.ts` — pragurile și regula de dominanță a axelor;
 *   - `types.ts`, `compat.ts` — tipurile și pragurile de compatibilitate.
 *
 * REscris: interfața. Gesturile folosesc EVENIMENTE DE POINTER (aceleași
 * handlere pentru deget, stylus și mouse), nu `PanResponder`. Efectul de
 * înclinare pe accelerometru (`useTiltSwipe`) NU e portat: e cosmetic și oricum
 * inactiv pe web.
 *
 * Direcțiile sunt identice cu cele din aplicația nativă:
 *   stânga = dislike · dreapta = like · sus = super like · jos = undo
 *
 * În capul ecranului stă bara de povești (`StoriesStrip`), ca pe nativ
 * (`mobile/app/(tabs)/ankete.tsx`). Ea derulează pe orizontală, iar cardul
 * ascultă gesturi pe ambele axe — două lucruri care se fură unul pe altul dacă
 * le lași. Izolarea e scrisă la ambele capete: bara își marchează zona și
 * oprește propagarea (`StoriesBar.tsx`), iar cardul ignoră orice gest pornit
 * într-o zonă străină (`onPointerDown`, mai jos).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { fetchFeed, swipe, undoSwipe } from '@mobile/features/feed/feedApi';
import { clasificaRefuzul, type SwipeBlock } from './swipeBlock';
import {
  resolveDirection,
  SWIPE_THRESHOLD_X,
  SWIPE_THRESHOLD_Y,
  type SwipeDirection,
} from '@mobile/features/feed/swipeDirection';
import type { FeedCard, SwipeAction } from '@mobile/features/feed/types';

import { StatusScreen, type StatusAction } from '@/components/StatusScreen';
import { chatPath } from '@/features/chat/chatRoutes';
import { ACTIVITY_UNREAD_KEY } from '@/features/notifications/activityApi';
import { CHATS_PATH } from '@/features/onboarding/paths';
import { StoriesStrip } from '@/features/stories/StoriesStrip';
import { variantUrl } from '@/lib/media';
import { haptic } from '@/telegram/bridge';

import { MatchOverlay } from './MatchOverlay';
import { ProfileCardView } from './ProfileCardView';
import { useInterestLabels } from './useInterestLabels';

/** Cât se mișcă degetul până acceptăm că e un gest, nu o atingere. */
const GESTURE_SLOP = 8;

/** Cât de departe „aruncăm" cardul în afara ecranului la o acțiune confirmată. */
const FLING = 1000;

interface Offset {
  x: number;
  y: number;
}

const ORIGIN: Offset = { x: 0, y: 0 };

/**
 * Cât durează zborul cardului (= tranziția `.deck__card--settling` din
 * `feed.css`). După atât, cardul care pleacă e scos din DOM chiar dacă
 * `transitionend` nu vine (fila în fundal, mișcare redusă).
 */
const FLY_MS = 220;

/** `transform`-ul cardului pentru un decalaj dat: translație + înclinare. */
function transformFor({ x, y }: Offset): string {
  const rotation = Math.max(-8, Math.min(8, (x / 300) * 8));
  return `translate(${x}px, ${y}px) rotate(${rotation}deg)`;
}

/**
 * Stilul inițial al cardului curent. E o constantă: React îl aplică o singură
 * dată, la montare, și nu mai atinge niciodată `transform`-ul scris din gest.
 */
const CURRENT_CARD_STYLE: CSSProperties = { transform: transformFor(ORIGIN) };

/** Opacitatea ștampilelor, ca variabile CSS pe card (vezi `.cue--*`). */
function cueVars({ x, y }: Offset): Record<string, string> {
  return {
    '--cue-like': String(cueOpacity(x, SWIPE_THRESHOLD_X)),
    '--cue-nope': String(cueOpacity(-x, SWIPE_THRESHOLD_X)),
    '--cue-super': String(cueOpacity(-y, SWIPE_THRESHOLD_Y)),
    '--cue-undo': String(cueOpacity(y, SWIPE_THRESHOLD_Y)),
  };
}

/**
 * Mută cardul DIRECT în DOM. În timpul gestului nu trece nimic prin starea
 * React: o re-randare a deck-ului la fiecare `pointermove` (60-120 pe secundă)
 * era exact „vâscozitatea" de la swipe.
 */
function paintCard(element: HTMLElement, offset: Offset): void {
  element.style.transform = transformFor(offset);
  for (const [name, value] of Object.entries(cueVars(offset))) {
    element.style.setProperty(name, value);
  }
}

const nextFrame: (callback: () => void) => number =
  typeof requestAnimationFrame === 'function'
    ? (callback) => requestAnimationFrame(callback)
    : (callback) => window.setTimeout(callback, 16);
const cancelFrame: (id: number) => void =
  typeof cancelAnimationFrame === 'function'
    ? (id) => cancelAnimationFrame(id)
    : (id) => window.clearTimeout(id);

/**
 * Preîncarcă o poză în cache-ul browserului. Varianta WebP poate lipsi (poze
 * vechi, fără variante): atunci preîncărcăm originalul, exact ce va cere
 * `<Photo>` după fallback.
 */
function preloadImage(url: string, original: string): void {
  if (typeof Image === 'undefined') return;
  const image = new Image();
  image.decoding = 'async';
  if (url !== original) {
    image.onerror = () => {
      const fallback = new Image();
      fallback.decoding = 'async';
      fallback.src = original;
    };
  }
  image.src = url;
}

/** Cardul tocmai trimis: zboară PESTE cel următor (deja afișat), apoi dispare. */
interface LeavingCard {
  id: number;
  card: FeedCard;
  photoIndex: number;
  interests: readonly string[];
  offset: Offset;
}

/** Cheia cache-ului cu lista de ankete (invalidată și din Setări, Profil, blocări). */
const FEED_QUERY_KEY = ['feed'] as const;

/**
 * Câte carduri pot rămâne nevăzute înainte să cerem lotul următor. Cu o rezervă
 * mică, cardul următor e deja acolo când userul ajunge la capăt.
 */
const PREFETCH_REMAINING = 2;

/**
 * Lotul următor de ankete: cardurile din `page` care NU sunt deja în `known`.
 *
 * `GET /feed/` întoarce un lot (`feed_limit`, implicit 10), ordonat după
 * compatibilitate, și exclude pe server tot ce userul a swipe-uit în TRECEREA
 * curentă. Deci aceeași cerere, repetată după ce lotul curent s-a consumat, aduce
 * exact următorii candidați. Cardurile încă nevăzute din lotul curent revin și
 * ele în răspuns; le scoatem aici, ca și dublurile din pagină.
 */
export function freshCards(known: readonly FeedCard[], page: readonly FeedCard[]): FeedCard[] {
  const seen = new Set(known.map((card) => card.userId));
  const out: FeedCard[] = [];
  for (const card of page) {
    if (seen.has(card.userId)) continue;
    seen.add(card.userId);
    out.push(card);
  }
  return out;
}

/**
 * Ce lipim la coada listei dintr-un lot cerut când userul stătea la `from`.
 *
 * Comparăm DOAR cu cardurile de la `from` încolo: cele încă nevăzute și cele
 * swipe-uite cât timp cererea era pe drum (serverul le-a putut citi înainte de
 * swipe). Cardurile de dinainte de `from` au fost swipe-uite și confirmate de
 * server ÎNAINTE de cerere — dacă serverul le trimite din nou, înseamnă că a
 * pornit o TRECERE NOUĂ (toți au fost văzuți, iar refuzații revin de la cel mai
 * compatibil). Atunci ele chiar trebuie să reapară, nu să fie ascunse ca dubluri.
 */
export function nextBatch(
  known: readonly FeedCard[],
  from: number,
  page: readonly FeedCard[],
): FeedCard[] {
  return freshCards(known.slice(Math.max(0, from)), page);
}

/**
 * Unde stă userul într-o listă NOUĂ de ankete.
 *
 * Ne ținem de CARDUL pe care stătea (`anchor`), nu de poziție. Dacă nu stătea
 * pe niciun card — lista anterioară era CONSUMATĂ — mergem la primul card pe
 * care nu l-a trecut deja. Înainte, poziția rămânea `index` (= capătul listei
 * vechi), iar o listă proaspătă de la server (invalidare din Setări, blocare)
 * îl lăsa pe ecranul „Nu mai sunt ankete" deși avea carduri noi.
 */
export function placeInNewList(
  previous: readonly FeedCard[] | undefined,
  index: number,
  next: readonly FeedCard[],
): number {
  const anchor = previous?.[index]?.userId ?? null;
  if (anchor !== null) {
    return Math.max(
      0,
      next.findIndex((card) => card.userId === anchor),
    );
  }
  // Lot LIPIT la coada listei (aceeași listă + carduri noi la final): userul
  // continuă exact de unde era. Contează la o trecere nouă, când cardurile
  // lipite sunt chiar cele refuzate deja — n-au voie să fie sărite ca „trecute".
  if (
    previous &&
    next.length >= previous.length &&
    previous.every((card, i) => next[i]?.userId === card.userId)
  ) {
    return Math.min(index, next.length);
  }
  const passed = new Set((previous ?? []).slice(0, index).map((card) => card.userId));
  const first = next.findIndex((card) => !passed.has(card.userId));
  return first === -1 ? next.length : first;
}

/**
 * Indiciul de gesturi apare O SINGURĂ DATĂ, ca un strat discret peste primul
 * card. Pentru tehnologiile de asistare textul rămâne mereu legat de card
 * (`aria-describedby`), deci nu se pierde nimic când stratul dispare.
 */
const GESTURE_HINT_KEY = 'flirt.feed.gestureHintSeen';

function readHintSeen(): boolean {
  try {
    return window.localStorage.getItem(GESTURE_HINT_KEY) === '1';
  } catch {
    // Stocare blocată (mod privat, WebView restrictiv): arătăm indiciul.
    return false;
  }
}

function writeHintSeen(): void {
  try {
    window.localStorage.setItem(GESTURE_HINT_KEY, '1');
  } catch {
    // Fără stocare, indiciul va reapărea la următoarea deschidere. Acceptabil.
  }
}

/** Opacitatea unui indiciu: 0 la start, 1 când s-a atins pragul direcției. */
function cueOpacity(distance: number, threshold: number): number {
  return Math.max(0, Math.min(1, distance / threshold));
}

export function SwipeDeck() {
  const { t } = useTranslation('miniapp');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery<FeedCard[]>({
    queryKey: FEED_QUERY_KEY,
    queryFn: fetchFeed,
  });

  const [index, setIndex] = useState(0);
  /** O anulare e în curs: gesturile așteaptă. Swipe-urile NU mai blochează. */
  const [busy, setBusy] = useState(false);
  /**
   * Swipe-uri CONFIRMATE de server în sesiunea asta. Oglinda din ref e citită
   * după un `await` (anularea așteaptă coada), unde starea din closure e veche.
   */
  const [swipeCount, setSwipeCount] = useState(0);
  const swipesRef = useRef(0);
  const setSwipes = useCallback((value: number) => {
    swipesRef.current = value;
    setSwipeCount(value);
  }, []);
  /** Cardurile care tocmai au plecat și încă zboară peste cel curent. */
  const [leaving, setLeaving] = useState<LeavingCard[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Refuz de autorizare: NU o eroare de reîncercat, ci ceva de rezolvat. */
  const [block, setBlock] = useState<SwipeBlock | null>(null);
  /** Match-ul tocmai produs de swipe-ul meu: cine e și unde e conversația. */
  const [match, setMatch] = useState<{ card: FeedCard; chatId: string | null } | null>(null);

  // Punctul de plecare al gestului curent. `null` = niciun deget pe card.
  const dragStart = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  /** Degetul a depășit pragul de gest? Dacă NU, ridicarea lui e o atingere. */
  const movedRef = useRef(false);
  /** Elementul cardului CURENT, mutat direct în DOM în timpul gestului. */
  const cardRef = useRef<HTMLDivElement | null>(null);
  /** Cadrul de animație programat și ultimul decalaj încă nedesenat. */
  const frameRef = useRef<number | null>(null);
  const pendingOffsetRef = useRef<Offset | null>(null);

  /**
   * Coada swipe-urilor trimise: cardul următor apare IMEDIAT, iar cererile
   * pleacă pe rând, în fundal. `pendingRef` = id-urile încă neconfirmate, în
   * ordine; `epochRef` crește la un eșec, ca swipe-urile puse în coadă DUPĂ
   * cel eșuat să nu mai plece (cardurile lor revin odată cu el).
   */
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef<string[]>([]);
  const epochRef = useRef(0);
  const leavingIdRef = useRef(0);
  const timersRef = useRef(new Set<number>());
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const id of timers) window.clearTimeout(id);
      timers.clear();
      if (frameRef.current !== null) cancelFrame(frameRef.current);
    };
  }, []);

  const cards = data ?? [];
  const current = cards[index];

  /**
   * Poza afișată, legată de cardul căruia îi aparține: la cardul următor
   * indicele pornește singur de la zero, fără un efect care să-l reseteze.
   */
  const [photo, setPhoto] = useState<{ userId: string | null; index: number }>({
    userId: null,
    index: 0,
  });
  const photoCount = current?.photos.length ?? 0;
  const photoIndex = current && photo.userId === current.userId ? photo.index : 0;
  const showPhoto = useCallback(
    (step: 1 | -1) => {
      if (!current || photoCount < 2) return;
      const next = Math.max(0, Math.min(photoCount - 1, photoIndex + step));
      if (next === photoIndex) return;
      haptic('light');
      setPhoto({ userId: current.userId, index: next });
    },
    [current, photoCount, photoIndex],
  );

  // Catalogul se cere doar dacă are ce traduce: un feed gol nu face cereri.
  const interestLabels = useInterestLabels((current?.topInterests.length ?? 0) > 0);
  // Props STABILE pentru `ProfileCardView` (memoizat): fără ele, orice
  // re-randare a deck-ului ar re-randa și cardul.
  const interests = useMemo(
    () => (current ? interestLabels(current.topInterests) : []),
    [current, interestLabels],
  );
  const prevPhoto = useCallback(() => showPhoto(-1), [showPhoto]);
  const nextPhoto = useCallback(() => showPhoto(1), [showPhoto]);

  /**
   * PREÎNCĂRCARE: prima poză a următoarelor două carduri și a doua poză a
   * cardului curent, în varianta pe care o va cere cardul (800, plus 256
   * pentru fundalul încețoșat). Când userul ajunge acolo, poza e deja în cache.
   */
  const preloadedRef = useRef(new Set<string>());
  useEffect(() => {
    const wanted: Array<[string, 256 | 800]> = [];
    const second = current?.photos[1];
    if (second) wanted.push([second, 800]);
    for (const card of [cards[index + 1], cards[index + 2]]) {
      const first = card?.photos[0];
      if (first) wanted.push([first, 800], [first, 256]);
    }
    for (const [original, size] of wanted) {
      const url = variantUrl(original, size) ?? original;
      if (preloadedRef.current.has(url)) continue;
      preloadedRef.current.add(url);
      preloadImage(url, original);
    }
  }, [cards, current, index]);
  const hintId = useId();
  const [hintSeen, setHintSeen] = useState(readHintSeen);
  const dismissHint = useCallback(() => {
    setHintSeen(true);
    writeHintSeen();
  }, []);

  /**
   * Înălțimea benzii de sus (povești + zona sigură), măsurată, ca indicatoarele
   * de poze și badge-ul să stea EXACT sub ea, oricât de înaltă ar fi pe
   * telefonul curent. Fără `ResizeObserver` (teste, WebView vechi) rămâne
   * valoarea de rezervă din CSS.
   */
  const rootRef = useRef<HTMLDivElement | null>(null);
  const topRef = useRef<HTMLDivElement | null>(null);
  const hasCard = current !== undefined;
  useEffect(() => {
    const root = rootRef.current;
    const top = topRef.current;
    if (!root || !top || typeof ResizeObserver === 'undefined') return;
    const sync = () => root.style.setProperty('--feed-top', `${top.offsetHeight}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(top);
    return () => observer.disconnect();
  }, [hasCard]);

  /** Lista pentru care `index` a fost calculat ultima dată. */
  const placedForRef = useRef<FeedCard[] | undefined>(undefined);
  /** Userul a cerut explicit un deck nou („Caută mai multe") → de la primul card. */
  const restartRef = useRef(false);

  /**
   * A venit o listă nouă: ne ținem de CARDUL pe care stătea userul, nu de
   * poziție. Regula e cea din aplicația nativă (`mobile/app/(tabs)/ankete.tsx`),
   * și contează mai mult de când poveștile se deschid din capul feedului:
   * `data` e o referință NOUĂ la fiecare refetch de fundal (fereastra revine în
   * față după ce userul a privit o poveste), chiar dacă vin exact aceleași
   * carduri. Un `setIndex(0)` legat de referință îl arunca pe user înapoi la
   * primul card în mijlocul răsfoirii.
   */
  useEffect(() => {
    if (!data || placedForRef.current === data) return;
    const previous = placedForRef.current;
    placedForRef.current = data;

    const next = restartRef.current ? 0 : placeInNewList(previous, index, data);
    restartRef.current = false;

    if (next === index) return;
    setIndex(next);
  }, [data, index]);

  /**
   * LOTUL URMĂTOR. Serverul dă ankete în loturi (10); fără asta, după al zecelea
   * swipe userul vedea „Nu mai sunt ankete acum" deși serverul mai avea zeci de
   * candidați — exact defectul din producție („nu se arată anketa"). Cerem lotul
   * următor când rămân `PREFETCH_REMAINING` carduri și îl LIPIM la coada listei
   * (aceeași cheie de cache), deci poziția userului nu se mișcă.
   *
   * Starea e legată de lista pentru care s-a constatat: o listă nouă
   * (reîncărcare, invalidare din Setări) are voie să ceară din nou. „Gata" e
   * legat și de POZIȚIA la care s-a constatat: după încă un swipe întrebăm din
   * nou, fiindcă după ultimul card serverul poate porni o trecere nouă (cei
   * refuzați revin). Ecranul gol rămâne doar pentru „serverul chiar n-are pe
   * nimeni", nici măcar după o trecere nouă.
   */
  const [more, setMore] = useState<{
    status: 'idle' | 'loading' | 'error' | 'done';
    /** Lista pentru care e valabilă starea; alta = `idle`. */
    list?: FeedCard[];
    /** Poziția la care s-a constatat „gata"; alta = `idle`. */
    at?: number;
  }>({ status: 'idle' });
  const moreStatus =
    more.list !== data || (more.status === 'done' && more.at !== index) ? 'idle' : more.status;
  const loadingMoreRef = useRef(false);
  const loadMore = useCallback(
    async (from: number) => {
      const base = queryClient.getQueryData<FeedCard[]>(FEED_QUERY_KEY);
      if (!base || loadingMoreRef.current) return;
      loadingMoreRef.current = true;
      setMore({ status: 'loading', list: base });
      try {
        // Swipe-urile optimiste de dinainte de `from` trebuie să fie CONFIRMATE
        // înainte de cerere — exact presupunerea lui `nextBatch`. Altfel serverul
        // le-ar putea trimite din nou și n-am ști dacă e o dublură sau o trecere
        // nouă. Lotul e cerut cu 2 carduri înainte, deci așteptarea nu se vede.
        const epoch = epochRef.current;
        await queueRef.current;
        if (epoch !== epochRef.current) {
          // Un swipe a eșuat și cardul a revenit: poziția s-a schimbat, deci
          // cererea se reia de la noua poziție (efectul de mai jos).
          setMore({ status: 'idle' });
          return;
        }
        const page = await fetchFeed();
        const known = queryClient.getQueryData<FeedCard[]>(FEED_QUERY_KEY) ?? base;
        // Lista a fost înlocuită între timp (reîncărcare): poziția nu mai e a ei,
        // deci comparăm cu toată lista.
        const fresh = known === base ? nextBatch(known, from, page) : freshCards(known, page);
        if (fresh.length === 0) {
          setMore({ status: 'done', list: known, at: from });
        } else {
          queryClient.setQueryData<FeedCard[]>(FEED_QUERY_KEY, [...known, ...fresh]);
          setMore({ status: 'idle' });
        }
      } catch {
        setMore({ status: 'error', list: base });
      } finally {
        loadingMoreRef.current = false;
      }
    },
    [queryClient],
  );

  const remaining = cards.length - index;
  useEffect(() => {
    // Un feed gol de la prima cerere e chiar „nu e nimeni": nu insistăm.
    if (!data || data.length === 0 || isError) return;
    if (remaining > PREFETCH_REMAINING || moreStatus !== 'idle') return;
    void loadMore(index);
  }, [data, isError, remaining, moreStatus, loadMore, index]);

  // ——— Mișcarea cardului, direct în DOM ———

  /** Renunță la cadrul programat (gestul s-a terminat sau a fost înlocuit). */
  const dropFrame = useCallback(() => {
    if (frameRef.current !== null) cancelFrame(frameRef.current);
    frameRef.current = null;
    pendingOffsetRef.current = null;
  }, []);

  /**
   * Desenează decalajul: primul `pointermove` dintr-un cadru se aplică imediat,
   * restul se adună și se desenează o singură dată, în cadrul următor.
   */
  const moveCard = useCallback((offset: Offset) => {
    const element = cardRef.current;
    if (!element) return;
    if (frameRef.current !== null) {
      pendingOffsetRef.current = offset;
      return;
    }
    paintCard(element, offset);
    frameRef.current = nextFrame(() => {
      frameRef.current = null;
      const pending = pendingOffsetRef.current;
      pendingOffsetRef.current = null;
      if (pending && cardRef.current) paintCard(cardRef.current, pending);
    });
  }, []);

  /** În timpul gestului sticla (`backdrop-filter`) e oprită, vezi `feed.css`. */
  const setDragging = useCallback((dragging: boolean) => {
    rootRef.current?.classList.toggle('is-dragging', dragging);
  }, []);

  const resetCard = useCallback(() => {
    dropFrame();
    setDragging(false);
    const element = cardRef.current;
    if (!element) return;
    element.classList.add('deck__card--settling');
    paintCard(element, ORIGIN);
  }, [dropFrame, setDragging]);

  // ——— Swipe optimist ———

  /** Scoate din DOM cardul care a terminat de zburat. */
  const removeLeaving = useCallback((id: number) => {
    setLeaving((list) =>
      list.some((item) => item.id === id) ? list.filter((item) => item.id !== id) : list,
    );
  }, []);

  /**
   * Fără tranziție (mișcare redusă: `transition: none`) cardul ajunge instant
   * în afara ecranului și n-ar mai primi niciodată `transitionend`: îl scoatem
   * imediat, nu după rezerva de timp.
   */
  const deckRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const deck = deckRef.current;
    if (!deck || leaving.length === 0) return;
    for (const element of deck.querySelectorAll<HTMLElement>('[data-leaving-id]')) {
      const duration = Number.parseFloat(getComputedStyle(element).transitionDuration);
      if (!(duration > 0)) removeLeaving(Number(element.dataset.leavingId));
    }
  }, [leaving, removeLeaving]);

  /**
   * Swipe-ul a eșuat: cardul REVINE pe ecran (împreună cu cele swipe-uite după
   * el, ale căror cereri nici n-au mai plecat), ca userul să poată reîncerca.
   */
  const rollBack = useCallback(
    (card: FeedCard, at: number, dropped: readonly string[]) => {
      const list = queryClient.getQueryData<FeedCard[]>(FEED_QUERY_KEY) ?? [];
      const back = list[at]?.userId === card.userId ? at : list.findIndex((c) => c.userId === card.userId);
      if (back !== -1) setIndex(back);
      const gone = new Set([card.userId, ...dropped]);
      setLeaving((items) => items.filter((item) => !gone.has(item.card.userId)));
    },
    [queryClient],
  );

  /**
   * Trimite swipe-ul ÎN FUNDAL. Cardul următor e deja pe ecran; cererile pleacă
   * pe rând (coada păstrează ordinea pentru undo și pentru server). La match se
   * deschide fereastra când vine răspunsul; la refuz/eroare cardul revine.
   */
  const performSwipe = useCallback(
    (card: FeedCard, action: SwipeAction, at: number) => {
      setActionError(null);
      pendingRef.current.push(card.userId);
      const epoch = epochRef.current;
      const run = async () => {
        try {
          // Un swipe de dinainte a eșuat: cardul ăsta a revenit odată cu el.
          if (epoch !== epochRef.current) return;
          const result = await swipe(card.userId, action);
          if (result.matched) {
            setMatch({ card, chatId: result.chatId ?? null });
            // Conversația există deja pe server (creată odată cu match-ul): lista de
            // mesaje și centrul de activitate se resincronizează, nu așteaptă poll-ul.
            void queryClient.invalidateQueries({ queryKey: ['chats'] });
            void queryClient.invalidateQueries({ queryKey: ACTIVITY_UNREAD_KEY });
          }
          setSwipes(swipesRef.current + 1);
        } catch (error) {
          epochRef.current += 1;
          const dropped = pendingRef.current.slice(pendingRef.current.indexOf(card.userId) + 1);
          rollBack(card, at, dropped);
          // Un refuz de autorizare NU e o eroare de reîncercat: reîncercarea dă exact
          // acelaşi răspuns. Utilizatorului îi lipseşte ceva — testul de umor, o poză,
          // profilul — şi trebuie dus acolo, cu buton. Fără asta rămâne blocat cu un
          // mesaj generic, exact ce s-a întâmplat în producţie.
          const refuz = clasificaRefuzul(error);
          if (refuz) setBlock(refuz);
          // Rețea sau server picat: cardul a revenit — utilizatorul poate reîncerca
          // exact aceeași alegere.
          else setActionError(t('feed.sendFailed'));
        } finally {
          const i = pendingRef.current.indexOf(card.userId);
          if (i !== -1) pendingRef.current.splice(i, 1);
        }
      };
      queueRef.current = queueRef.current.then(run);
    },
    [queryClient, rollBack, setSwipes, t],
  );

  const closeMatch = useCallback(() => setMatch(null), []);
  const writeToMatch = useCallback(() => {
    const chatId = match?.chatId;
    setMatch(null);
    void navigate(chatId ? chatPath(chatId) : CHATS_PATH);
  }, [match, navigate]);

  const onUndo = useCallback(async () => {
    if (busy || (swipesRef.current === 0 && pendingRef.current.length === 0)) return;
    setBusy(true);
    setActionError(null);
    try {
      // Swipe-urile optimiste încă pe drum se confirmă ÎNTÂI: undo anulează
      // ultimul swipe înregistrat de server, nu o cerere care încă n-a ajuns.
      await queueRef.current;
      // Ultimul swipe a eșuat și cardul a revenit deja: nu e nimic de anulat.
      if (swipesRef.current === 0) return;
      const result = await undoSwipe();
      if (result.undone) {
        setSwipes(Math.max(0, swipesRef.current - 1));
        setIndex((i) => Math.max(0, i - 1));
      } else {
        // REFUZ, nu eșec: `POST /feed/undo` răspunde 200 cu `undone: false`
        // (`backend/app/services/feed_service.py::undo_last_swipe`) când nu
        // găsește niciun `Like` al userului — singurul caz în care refuză.
        // Se întâmplă real: swipe-urile numărate aici sunt DOAR cele din
        // sesiunea curentă, iar ultimul like poate să nu mai existe pe server
        // (anulat de pe alt dispozitiv, sau șters odată cu contul celui plăcut).
        // Fără ramura asta, utilizatorul apăsa „Anulează", cardul nu revenea și
        // pe ecran nu apărea NIMIC.
        setActionError(t('feed.undoNothing'));
        // Serverul e sursa de adevăr: dacă el nu are ce anula, nici noi nu mai
        // arătăm butonul de undo.
        setSwipes(0);
      }
    } catch {
      setActionError(t('feed.undoFailed'));
    } finally {
      setBusy(false);
    }
  }, [busy, setSwipes, t]);

  /**
   * Punctul UNIC în care o direcție devine acțiune — degetul și butoanele de
   * accesibilitate ajung amândouă aici, ca „stânga" să însemne același lucru.
   */
  const runDirection = useCallback(
    (direction: SwipeDirection) => {
      if (direction === 'down') {
        resetCard();
        void onUndo();
        return;
      }
      // Același card de două ori (atingeri rapide, înainte de re-randare)? Nu.
      if (!current || busy || pendingRef.current.includes(current.userId)) {
        resetCard();
        return;
      }

      haptic('light');
      // Primul swipe reușit e dovada că gestul a fost înțeles.
      if (!hintSeen) dismissHint();
      dropFrame();
      setDragging(false);

      // Confirmare vizuală: cardul pleacă în direcția gestului (copia lui zboară
      // peste cardul următor, care e afișat IMEDIAT), iar cererea pleacă în fundal.
      const fling: Offset =
        direction === 'right'
          ? { x: FLING, y: 0 }
          : direction === 'left'
            ? { x: -FLING, y: 0 }
            : { x: 0, y: -FLING };
      leavingIdRef.current += 1;
      const id = leavingIdRef.current;
      setLeaving((items) => [
        ...items.filter((item) => item.card.userId !== current.userId),
        { id, card: current, photoIndex, interests, offset: fling },
      ]);
      const timer = window.setTimeout(() => {
        timersRef.current.delete(timer);
        removeLeaving(id);
      }, FLY_MS + 80);
      timersRef.current.add(timer);
      setIndex(index + 1);

      const action: SwipeAction =
        direction === 'right' ? 'like' : direction === 'left' ? 'dislike' : 'super_like';
      performSwipe(current, action, index);
    },
    [
      busy,
      current,
      dismissHint,
      dropFrame,
      hintSeen,
      index,
      interests,
      onUndo,
      performSwipe,
      photoIndex,
      removeLeaving,
      resetCard,
      setDragging,
    ],
  );

  // ——— Gesturi cu evenimente de pointer ———

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (busy) return;
    // Gestul a pornit în altă zonă (bara de povești)? Atunci nu e al cardului.
    // Garda e explicită, nu bazată pe faptul — azi adevărat — că bara nu e un
    // descendent al cardului: dacă mâine cineva mută bara peste card, cardul tot
    // nu-i fură derularea, iar testul de izolare rămâne valabil.
    const zone = (event.target as Element | null)?.closest?.('[data-gesture-zone]') ?? null;
    if (zone !== null && zone !== event.currentTarget) return;
    dragStart.current = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
    movedRef.current = false;
    // Degetul ține cardul: fără tranziție, altfel cardul ar rămâne în urma lui.
    dropFrame();
    event.currentTarget.classList.remove('deck__card--settling');
    // Capturarea pointerului ține gestul legat de card chiar dacă degetul iese
    // din el — fără asta, un swipe rapid „scapă" și cardul rămâne agățat.
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < GESTURE_SLOP && Math.abs(dy) < GESTURE_SLOP) return;
    if (!movedRef.current) setDragging(true);
    movedRef.current = true;
    moveCard({ x: dx, y: dy });
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    dragStart.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;

    // ATINGERE, nu gest: degetul n-a trecut niciodată de prag. Jumătatea
    // stângă a cardului = poza anterioară, dreapta = următoarea (ca la stories).
    if (!movedRef.current && Math.abs(dx) < GESTURE_SLOP && Math.abs(dy) < GESTURE_SLOP) {
      resetCard();
      if (photoCount > 1) {
        const rect = event.currentTarget.getBoundingClientRect();
        showPhoto(event.clientX - rect.left < rect.width / 2 ? -1 : 1);
      }
      return;
    }

    const direction = resolveDirection(dx, dy);
    // Gest scurt sau diagonal (indecis) → cardul revine. Nu ghicim intenția.
    if (!direction) {
      resetCard();
      return;
    }
    runDirection(direction);
  };

  const onPointerCancel = () => {
    dragStart.current = null;
    movedRef.current = false;
    resetCard();
  };

  // ——— Randare ———

  // Ruta feedului e „pe tot ecranul" (`app-shell__content--bleed`): cadrul nu
  // mai dă margini. Stările fără card și le pun singure, prin `.feed-status`.
  if (isLoading) {
    return (
      <div className="feed-status">
        <StatusScreen
          loading
          testId="status-feed-loading"
          title={t('feed.loading')}
          body={t('feed.loadingBody')}
        />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="feed-status">
        <StatusScreen
          testId="status-feed-error"
          title={t('errors.network.title')}
          body={t('feed.error')}
          actions={[
            {
              label: t('actions.retry', { ns: 'common' }),
              onClick: () => void refetch(),
              testId: 'deck-retry',
            },
          ]}
        />
      </div>
    );
  }

  const matchModal =
    match !== null ? (
      <MatchOverlay
        name={match.card.name}
        photo={match.card.photos[0] ?? null}
        onWrite={writeToMatch}
        onContinue={closeMatch}
      />
    ) : null;

  const errorText = actionError ? (
    <p className="error-text feed__toast" role="alert" data-testid="deck-action-error">
      {actionError}
    </p>
  ) : null;

  // Refuzul se afişează ca panou cu ACŢIUNE, nu ca text. Un mesaj fără buton e o
  // fundătură: utilizatorul află că nu poate, dar nu şi cum să poată.
  const blockPanel = block ? (
    <div className="deck-block" role="alert" data-testid="deck-block">
      <h2 className="deck-block__title">{t(block.titleKey)}</h2>
      <p className="deck-block__body">{t(block.bodyKey)}</p>
      <div className="deck-block__actions">
        {block.to && block.actionKey ? (
          <button
            type="button"
            className="button"
            data-testid="deck-block-action"
            onClick={() => navigate(block.to as string)}
          >
            {t(block.actionKey)}
          </button>
        ) : null}
        <button
          type="button"
          className="button button--ghost"
          data-testid="deck-block-dismiss"
          onClick={() => setBlock(null)}
        >
          {t('actions.close')}
        </button>
      </div>
    </div>
  ) : null;

  if (!current && (moreStatus === 'loading' || (moreStatus === 'idle' && cards.length > 0))) {
    // Lotul următor e pe drum: NU e „nu mai sunt ankete" — încă nu știm.
    return (
      <div className="feed-status">
        <StoriesStrip />
        <StatusScreen
          loading
          testId="status-feed-loading-more"
          title={t('feed.loading')}
          body={t('feed.loadingBody')}
        >
          {matchModal}
        </StatusScreen>
      </div>
    );
  }

  if (!current && moreStatus === 'error') {
    return (
      <div className="feed-status">
        <StatusScreen
          testId="status-feed-error"
          title={t('errors.network.title')}
          body={t('feed.error')}
          actions={[
            {
              label: t('actions.retry', { ns: 'common' }),
              onClick: () => void loadMore(index),
              testId: 'deck-retry',
            },
          ]}
        >
          {matchModal}
        </StatusScreen>
      </div>
    );
  }

  if (!current) {
    // Feed gol NU e o eroare, și ecranul trebuie să spună asta răspicat. E chiar
    // starea din producție pentru un cont nou într-un oraș mic: nu mai sunt
    // profiluri de arătat acum. Un ecran gol, fără titlu și fără explicație, a
    // fost citit de utilizatori drept „aplicația nu merge".
    const actions: StatusAction[] = [
      {
        label: t('feed.reload'),
        testId: 'deck-reload',
        onClick: () => {
          // Cerere explicită de deck nou: reperul de mai sus n-are ce căuta
          // aici, altfel ne-ar duce înapoi la cardul de dinainte.
          restartRef.current = true;
          setIndex(0);
          void refetch();
        },
      },
    ];
    if (swipeCount > 0) {
      actions.push({
        label: t('feed.undo'),
        testId: 'deck-undo',
        ghost: true,
        disabled: busy,
        onClick: () => void onUndo(),
      });
    }

    return (
      <div className="feed-status">
        {/* Poveștile rămân la locul lor și când nu mai sunt ankete: ele sunt
            conținut proaspăt, exact ce mai are de făcut userul aici. La fel pe
            nativ, în ramura de deck gol din `app/(tabs)/ankete.tsx`. */}
        <StoriesStrip />
        <StatusScreen
          testId="status-feed-empty"
          title={t('feed.empty')}
          body={t('feed.emptyBody')}
          actions={actions}
        >
          {blockPanel}
          {errorText}
          {matchModal}
        </StatusScreen>
      </div>
    );
  }

  // Ștampilele direcțiilor: opacitatea vine din variabilele CSS ale cardului,
  // scrise direct în DOM în timpul gestului (`paintCard`).
  const cues = (
    <>
      <span className="cue cue--like">{t('feed.cue.like')}</span>
      <span className="cue cue--nope">{t('feed.cue.nope')}</span>
      <span className="cue cue--super">{t('feed.cue.super')}</span>
      <span className="cue cue--undo">{t('feed.cue.undo')}</span>
    </>
  );

  return (
    <div className="feed" ref={rootRef} data-testid="feed-screen">
      {/* Banda de sus: poveștile, pe sticlă mată PESTE poză. Stă înaintea
          cardului în document (ordinea de citire: întâi poveștile), dar e
          deasupra lui vizual. Doar ea are fundal încețoșat; restul ecranului e
          poza însăși. */}
      <div className="feed__top" ref={topRef}>
        <StoriesStrip />
      </div>

      <div className="deck" ref={deckRef}>
        {/* Cheia e id-ul userului ȘI la cardul curent, ȘI la cel care pleacă:
            React păstrează ACELAȘI element când cardul trece în zbor, deci
            pozele lui nu se reîncarcă, iar zborul pornește exact de unde l-a
            lăsat degetul. Cardul următor apare dedesubt, imediat. */}
        <div
          key={current.userId}
          ref={cardRef}
          className="deck__card"
          data-testid="deck-card"
          data-gesture-zone="deck"
          style={CURRENT_CARD_STYLE}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={onPointerCancel}
        >
          <ProfileCardView
            card={current}
            photoIndex={photoIndex}
            interests={interests}
            onPrevPhoto={prevPhoto}
            onNextPhoto={nextPhoto}
            describedBy={hintId}
            priority
          />
          {cues}
        </div>

        {leaving
          .filter((item) => item.card.userId !== current.userId)
          .map((item) => (
            <div
              key={item.card.userId}
              className="deck__card deck__card--settling deck__card--leaving"
              data-testid="deck-card-leaving"
              data-leaving-id={item.id}
              aria-hidden="true"
              style={{ transform: transformFor(item.offset), ...cueVars(item.offset) } as CSSProperties}
              onTransitionEnd={(event) => {
                if (event.target === event.currentTarget) removeLeaving(item.id);
              }}
            >
              <ProfileCardView
                card={item.card}
                photoIndex={item.photoIndex}
                interests={item.interests}
                priority
              />
              {cues}
            </div>
          ))}
      </div>

      {/* Descrierea gesturilor rămâne MEREU pentru cititoarele de ecran. */}
      <p id={hintId} className="visually-hidden">
        {t('feed.hint')}
      </p>

      {!hintSeen ? (
        <div className="feed__coach" data-testid="feed-gesture-hint">
          <p className="feed__coach-text" aria-hidden="true">
            {t('feed.hint')}
          </p>
          <button
            type="button"
            className="feed__coach-button"
            data-testid="feed-gesture-hint-dismiss"
            onClick={dismissHint}
          >
            {t('screens:feedCard.gotIt')}
          </button>
        </div>
      ) : null}

      {blockPanel || errorText ? (
        <div className="feed__notices">
          {blockPanel}
          {errorText}
        </div>
      ) : null}

      {matchModal}
    </div>
  );
}
