/**
 * Achiziții native în aplicație (StoreKit 2 pe iOS, Play Billing pe Android),
 * peste `expo-iap`.
 *
 * Guideline 3.1.1: conținutul digital se vinde EXCLUSIV prin In-App Purchase.
 * De aceea aici nu există niciun provider extern de plăți — magazinul încasează,
 * iar backend-ul doar VALIDEAZĂ dovada de plată și activează abonamentul.
 *
 * ORDINEA E SACRĂ, în această ordine și în niciuna alta:
 *   1. magazinul întoarce tranzacția (cu JWS-ul StoreKit 2);
 *   2. backend-ul o confirmă (`POST /subscriptions/purchase` cu `receipt`);
 *   3. abia apoi `finishTransaction`.
 * Dacă am finaliza tranzacția înaintea confirmării și backend-ul ar pica, userul
 * ar rămâne plătit și fără abonament, iar dovada ar dispărea DEFINITIV din coada
 * magazinului — bani luați, produs nelivrat. O tranzacție neconfirmată rămâne
 * deliberat nefinalizată: magazinul o reia la următoarea pornire, iar
 * `resumeUnfinishedPurchases` o duce la capăt.
 */
import {
  endConnection,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  restorePurchases,
} from 'expo-iap';
import type { AndroidSubscriptionOfferInput, ProductOrSubscription, Purchase } from 'expo-iap';

import { config } from '@/config';
import { purchase as confirmOnServer } from '@/features/subscription/subscriptionApi';
import type { Subscription } from '@/features/subscription/types';

/* ------------------------------- Erori --------------------------------- */

/**
 * Cauzele pe care ecranul le tratează DIFERIT. `cancelled` nu e o eroare de
 * afișat (userul a închis foaia de plată intenționat), iar `not-confirmed` e
 * singurul caz în care userul a plătit deja — mesajul trebuie să-l liniștească,
 * nu să-i ceară să plătească din nou.
 */
export type IapErrorKind =
  | 'cancelled'
  | 'pending'
  | 'unavailable'
  | 'product-missing'
  | 'not-confirmed'
  | 'already-owned'
  | 'unknown';

/** Eroare de achiziție cu mesaj gata de afișat (română) și cauză pentru UI. */
export class IapError extends Error {
  readonly kind: IapErrorKind;

  constructor(kind: IapErrorKind, message: string) {
    super(message);
    this.name = 'IapError';
    this.kind = kind;
  }
}

const MSG = {
  cancelled: 'Ai anulat achiziția.',
  unavailable:
    'Magazinul nu este disponibil pe acest dispozitiv. Verifică-ți conexiunea și contul din App Store.',
  productMissing:
    'Planul nu este disponibil în magazin momentan. Încearcă mai târziu sau alege alt plan.',
  notConfirmed:
    'Plata a fost înregistrată de magazin, dar nu am putut activa abonamentul acum. ' +
    'Nu vei fi taxat din nou — reluăm activarea automat când revii în aplicație.',
  alreadyOwned:
    'Ai deja acest abonament. Apasă „Restaurează achizițiile" ca să îl reactivezi pe acest dispozitiv.',
  pendingApproval:
    'Achiziția este în așteptarea aprobării. Abonamentul se activează singur imediat ce plata e confirmată.',
  noReceipt: 'Magazinul nu a întors dovada de plată. Reîncearcă achiziția.',
  inProgress: 'O achiziție este deja în curs. Așteaptă finalizarea ei.',
  unknown: 'Nu am putut finaliza achiziția. Reîncearcă.',
} as const;

/**
 * Coduri din protocolul OpenIAP (nu sunt configurabile — fac parte din contractul
 * bibliotecii, ca statusurile HTTP). Le comparăm ca string ca să nu depindem de
 * enum-ul runtime al pachetului.
 */
const CODE_CANCELLED = 'user-cancelled';
const CODE_ALREADY_OWNED = 'already-owned';
const CODE_DEFERRED = 'deferred-payment';
const CODE_PENDING = 'pending';
const CODE_UNAVAILABLE = new Set([
  'iap-not-available',
  'init-connection',
  'not-prepared',
  'billing-unavailable',
  'service-disconnected',
  'service-error',
  'service-timeout',
  'network-error',
  'connection-closed',
]);
const CODE_PRODUCT_MISSING = new Set(['sku-not-found', 'item-unavailable', 'empty-sku-list']);

/**
 * Forma minimă a unei erori de magazin. O descriem structural pentru că
 * `expo-iap` exportă două tipuri `PurchaseError` ușor diferite (types vs.
 * errorMapping), iar noi avem nevoie doar de cod.
 */
interface StoreError {
  code?: string | null;
  message?: string;
}

/** Traduce orice eroare (magazin, rețea, cod) într-un `IapError` cu mesaj RO. */
function asIapError(error: unknown): IapError {
  if (error instanceof IapError) return error;

  const code = String((error as StoreError | undefined)?.code ?? '');
  if (code === CODE_CANCELLED) return new IapError('cancelled', MSG.cancelled);
  if (code === CODE_ALREADY_OWNED) return new IapError('already-owned', MSG.alreadyOwned);
  if (code === CODE_DEFERRED || code === CODE_PENDING) {
    return new IapError('pending', MSG.pendingApproval);
  }
  if (CODE_UNAVAILABLE.has(code)) return new IapError('unavailable', MSG.unavailable);
  if (CODE_PRODUCT_MISSING.has(code)) return new IapError('product-missing', MSG.productMissing);
  return new IapError('unknown', MSG.unknown);
}

/* ------------------------------- Tipuri -------------------------------- */

/** Un produs așa cum îl întoarce MAGAZINUL (prețul e cel real, localizat). */
export interface StoreProduct {
  /** Codul planului din catalogul backend-ului (`premium`, `no_ads`, …). */
  plan: string;
  productId: string;
  /**
   * Prețul formatat de magazin, în moneda și formatul regiunii userului
   * (ex. „9,99 €", „$9.99"). Apple cere ca prețul AFIȘAT să fie exact acesta —
   * un preț hardcodat în cod sau venit din backend se poate desincroniza de
   * App Store Connect și duce la respingere.
   */
  displayPrice: string;
  currency: string;
  title: string;
  description: string;
}

export interface StoreCatalog {
  products: StoreProduct[];
  /**
   * Planuri care AU un ID de produs în config, dar pe care magazinul nu le-a
   * întors (ID greșit în App Store Connect, produs neaprobat, contract fiscal
   * nesemnat). Ecranul trebuie să le raporteze explicit — un paywall gol și mut
   * e respins pe Guideline 2.1.
   */
  missingPlans: string[];
}

/** Rezultatul unei achiziții duse până la capăt (sau lăsate în așteptare). */
export type PurchaseOutcome =
  | { status: 'active'; plan: string; subscription: Subscription }
  | { status: 'pending'; plan: string };

export interface RestoreResult {
  /** Planurile găsite în contul de magazin și reactivate pe backend. */
  restoredPlans: string[];
}

/* ------------------------------ Stare ---------------------------------- */

/** Conexiunea la magazin — o singură dată per sesiune, refolosită de toți. */
let connection: Promise<void> | null = null;
let listeners: { remove: () => void }[] = [];

/**
 * Fluxul de achiziție în desfășurare. `requestPurchase` NU întoarce rezultatul
 * (magazinul îl livrează prin listener, posibil și după minute de Ask to Buy),
 * așa că ținem aici promisiunea pe care o va rezolva listener-ul.
 */
interface PendingFlow {
  plan: string;
  productId: string;
  resolve: (outcome: PurchaseOutcome) => void;
  reject: (error: IapError) => void;
}
let flow: PendingFlow | null = null;

/** Ofertele Android (offerToken) sunt obligatorii la cumpărarea unui abonament. */
let androidOffers: Record<string, AndroidSubscriptionOfferInput[]> = {};

/** Închide fluxul curent o SINGURĂ dată (listener-ul poate fi chemat de 2 ori). */
function settleFlow(action: (pending: PendingFlow) => void): void {
  const pending = flow;
  if (!pending) return;
  flow = null;
  action(pending);
}

/* --------------------------- Config ↔ magazin --------------------------- */

/** ID-ul de produs pentru un plan (din `app.json`, niciodată hardcodat aici). */
function productIdFor(plan: string): string {
  const productId = config.iap.productIds[plan];
  if (!productId) throw new IapError('product-missing', MSG.productMissing);
  return productId;
}

/** Drumul invers: magazinul ne dă un productId, backend-ul vrea codul planului. */
function planForProduct(productId: string): string | null {
  const found = Object.entries(config.iap.productIds).find(([, id]) => id === productId);
  return found ? found[0] : null;
}

/* ---------------------------- Conexiune -------------------------------- */

/** Deschide conexiunea la magazin și atașează listener-ele (idempotent). */
export async function connectStore(): Promise<void> {
  if (!connection) {
    connection = (async () => {
      const ready = await initConnection();
      if (!ready) throw new IapError('unavailable', MSG.unavailable);
      attachListeners();
    })().catch((error) => {
      // Conexiunea eșuată nu se memorează: userul poate reîncerca fără restart.
      connection = null;
      throw asIapError(error);
    });
  }
  return connection;
}

function attachListeners(): void {
  if (listeners.length > 0) return;
  listeners = [
    purchaseUpdatedListener((purchase) => {
      void onPurchaseUpdated(purchase);
    }),
    purchaseErrorListener((error) => {
      onPurchaseError(error);
    }),
  ];
}

/** Închide conexiunea (la ieșirea din zona de billing / în teardown-ul testelor). */
export async function disconnectStore(): Promise<void> {
  listeners.forEach((listener) => listener.remove());
  listeners = [];
  flow = null;
  androidOffers = {};
  const wasConnected = connection !== null;
  connection = null;
  if (wasConnected) await endConnection();
}

/* ----------------------------- Produse --------------------------------- */

/**
 * Aduce produsele din magazin, cu prețurile REALE. Planurile configurate pe care
 * magazinul nu le cunoaște sunt raportate separat, nu ascunse: ecranul le arată
 * ca indisponibile în loc să lase carduri fără preț și fără buton.
 */
export async function fetchStoreCatalog(): Promise<StoreCatalog> {
  await connectStore();

  const entries = Object.entries(config.iap.productIds);
  if (entries.length === 0) return { products: [], missingPlans: [] };

  const skus = entries.map(([, productId]) => productId);
  const raw = ((await fetchProducts({ skus, type: 'subs' })) ?? []) as ProductOrSubscription[];

  androidOffers = {};
  const products: StoreProduct[] = [];
  const missingPlans: string[] = [];

  entries.forEach(([plan, productId]) => {
    const found = raw.find((item) => item.id === productId);
    if (!found) {
      missingPlans.push(plan);
      return;
    }
    products.push({
      plan,
      productId,
      displayPrice: found.displayPrice,
      currency: found.currency,
      title: found.title,
      description: found.description,
    });

    // Play Billing refuză cumpărarea unui abonament fără offerToken; pe iOS
    // câmpul lipsește pur și simplu, deci rămâne un obiect gol.
    const offers = (
      found as { subscriptionOfferDetailsAndroid?: { offerToken: string }[] | null }
    ).subscriptionOfferDetailsAndroid;
    if (offers?.length) {
      androidOffers[productId] = offers.map((offer) => ({ sku: productId, offerToken: offer.offerToken }));
    }
  });

  return { products, missingPlans };
}

/* ---------------------------- Achiziție -------------------------------- */

/**
 * Dovada de plată trimisă backend-ului. Pe iOS, `purchaseToken` E chiar JWS-ul
 * semnat de StoreKit 2 (câmp unificat în expo-iap 4.x); versiunile mai vechi îl
 * expuneau ca `jwsRepresentationIos`, de aceea îl citim și pe acela înainte de a
 * declara că nu avem dovadă. Fără dovadă backend-ul nu poate valida nimic la
 * Apple, deci NU finalizăm tranzacția.
 */
function extractReceipt(purchase: Purchase): string | null {
  const legacy = (purchase as { jwsRepresentationIos?: string | null }).jwsRepresentationIos;
  return purchase.purchaseToken ?? legacy ?? null;
}

/**
 * Pasul care nu are voie să fie greșit: confirmă la backend, ȘI ABIA APOI
 * finalizează tranzacția la magazin.
 */
async function confirmThenFinish(plan: string, purchase: Purchase): Promise<Subscription> {
  const receipt = extractReceipt(purchase);
  if (!receipt) throw new IapError('not-confirmed', MSG.noReceipt);

  let subscription: Subscription;
  try {
    // (1) Backend-ul validează JWS-ul la Apple și activează abonamentul.
    subscription = await confirmOnServer(plan, receipt);
  } catch {
    // Backend picat sau rețea căzută la exact acest pas: ieșim FĂRĂ
    // `finishTransaction`. Tranzacția rămâne în coada magazinului și e reluată
    // de `resumeUnfinishedPurchases` / „Restaurează achizițiile".
    throw new IapError('not-confirmed', MSG.notConfirmed);
  }

  try {
    // (2) Confirmată — acum o putem scoate din coadă.
    await finishTransaction({ purchase, isConsumable: false });
  } catch {
    // Abonamentul e deja activ pe backend, deci userul are ce a plătit. Dacă
    // finalizarea a eșuat, magazinul va relua tranzacția, iar confirmarea de mai
    // sus e idempotentă (același JWS → același abonament).
  }

  return subscription;
}

/** Livrarea unei tranzacții de la magazin (inclusiv cele reluate la pornire). */
async function onPurchaseUpdated(purchase: Purchase): Promise<void> {
  const plan = planForProduct(purchase.productId);
  if (!plan) {
    // Produs necunoscut catalogului: backend-ul nu are ce activa, deci nu-l
    // finalizăm (nu aruncăm o tranzacție pe care nu o înțelegem).
    settleFlow((pending) => pending.reject(new IapError('product-missing', MSG.productMissing)));
    return;
  }

  // Ask to Buy / plată amânată: banii NU s-au luat încă. Nu trimitem nimic la
  // backend și nu finalizăm — magazinul ne va rechema când plata e aprobată.
  if (purchase.purchaseState === 'pending') {
    settleFlow((pending) => pending.resolve({ status: 'pending', plan }));
    return;
  }

  try {
    const subscription = await confirmThenFinish(plan, purchase);
    settleFlow((pending) => pending.resolve({ status: 'active', plan, subscription }));
  } catch (error) {
    settleFlow((pending) => pending.reject(asIapError(error)));
  }
}

function onPurchaseError(error: StoreError): void {
  // „Already owned": userul a plătit deja (reinstalare, alt device). Nu-i cerem
  // banii a doua oară — recuperăm tranzacția existentă din magazin.
  if (String(error.code) === CODE_ALREADY_OWNED && flow) {
    void recoverAlreadyOwned();
    return;
  }
  settleFlow((pending) => pending.reject(asIapError(error)));
}

async function recoverAlreadyOwned(): Promise<void> {
  const pending = flow;
  if (!pending) return;
  try {
    const owned = (await getAvailablePurchases()).find(
      (item) => item.productId === pending.productId,
    );
    if (!owned) throw new IapError('already-owned', MSG.alreadyOwned);
    const subscription = await confirmThenFinish(pending.plan, owned);
    settleFlow((current) =>
      current.resolve({ status: 'active', plan: current.plan, subscription }),
    );
  } catch (error) {
    settleFlow((current) => current.reject(asIapError(error)));
  }
}

/**
 * Pornește achiziția unui plan. Rezultatul vine prin listener (magazinul poate
 * răspunde și după minute — 3D Secure, Ask to Buy), de aceea promisiunea se
 * rezolvă din `onPurchaseUpdated`, nu din valoarea întoarsă de `requestPurchase`.
 */
export async function purchasePlan(plan: string): Promise<PurchaseOutcome> {
  const productId = productIdFor(plan);

  // Verificăm întâi că magazinul chiar vinde produsul: altfel `requestPurchase`
  // eșuează cu un cod obscur, iar userul rămâne cu un spinner fără explicație.
  const catalog = await fetchStoreCatalog();
  if (!catalog.products.some((product) => product.plan === plan)) {
    throw new IapError('product-missing', MSG.productMissing);
  }

  if (flow) throw new IapError('unknown', MSG.inProgress);

  return new Promise<PurchaseOutcome>((resolve, reject) => {
    flow = { plan, productId, resolve, reject };
    requestPurchase({
      type: 'subs',
      request: {
        apple: {
          sku: productId,
          // NU lăsăm StoreKit să finalizeze singur: finalizarea vine doar după
          // ce backend-ul confirmă (vezi `confirmThenFinish`).
          andDangerouslyFinishTransactionAutomatically: false,
        },
        google: {
          skus: [productId],
          subscriptionOffers: androidOffers[productId] ?? [],
        },
      },
    }).catch((error: unknown) => {
      settleFlow((pending) => pending.reject(asIapError(error)));
    });
  });
}

/* ------------------- Restaurare / tranzacții rămase --------------------- */

/**
 * Confirmă la backend tot ce deține userul în magazin și finalizează tranzacțiile
 * rămase agățate. Rulează pe rând: o tranzacție care nu poate fi confirmată e
 * lăsată nefinalizată (va fi reluată), fără să blocheze restul listei.
 */
async function redeemAvailable(): Promise<string[]> {
  const purchases = await getAvailablePurchases();
  const plans: string[] = [];

  for (const purchase of purchases) {
    const plan = planForProduct(purchase.productId);
    if (!plan || purchase.purchaseState === 'pending') continue;
    try {
      await confirmThenFinish(plan, purchase);
      if (!plans.includes(plan)) plans.push(plan);
    } catch {
      // Rămâne pentru data viitoare — mai bine o reluăm decât să o pierdem.
    }
  }

  return plans;
}

/**
 * „Restaurează achizițiile" — OBLIGATORIU pentru abonamente (Guideline 3.1.2).
 * Fără acest buton aplicația e respinsă, iar userul care își schimbă telefonul
 * ar plăti a doua oară.
 */
export async function restore(): Promise<RestoreResult> {
  await connectStore();
  await restorePurchases();
  return { restoredPlans: await redeemAvailable() };
}

/**
 * Reia tranzacțiile rămase neconfirmate (backend picat, aplicație închisă în
 * mijlocul plății, Ask to Buy aprobat între timp). Se cheamă la intrarea pe
 * ecranul de abonamente: e plasa de siguranță care garantează că nimeni nu
 * rămâne plătit și fără produs.
 */
export async function resumeUnfinishedPurchases(): Promise<string[]> {
  await connectStore();
  return redeemAvailable();
}
