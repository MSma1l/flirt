/**
 * Acces la API pentru Abonamente / Paywall (TZ secț. 9).
 * Mapare snake_case ↔ camelCase (ex. price_eur → priceEur).
 */
import { api } from '@/services/api';

import { Entitlements, Plan, Subscription } from './types';

/* ------------------------- Forme brute (backend) ------------------------- */

interface PlanResponse {
  code: string;
  title: string;
  price_eur: number;
  features: string[];
}

interface SubscriptionResponse {
  plan: string;
  status: string;
  expires_at: string;
}

interface EntitlementsResponse {
  premium: boolean;
  no_ads: boolean;
  ai_bot: boolean;
}

/* ------------------------------- Mapare -------------------------------- */

function mapPlan(p: PlanResponse): Plan {
  return {
    code: p.code,
    title: p.title,
    priceEur: p.price_eur,
    features: p.features ?? [],
  };
}

function mapSubscription(s: SubscriptionResponse): Subscription {
  return {
    plan: s.plan,
    status: s.status,
    expiresAt: s.expires_at,
  };
}

function mapEntitlements(e: EntitlementsResponse): Entitlements {
  return {
    premium: !!e.premium,
    noAds: !!e.no_ads,
    aiBot: !!e.ai_bot,
  };
}

/* ------------------------------- API ----------------------------------- */

/** Aduce planurile disponibile (public) și le mapează în camelCase. */
export async function fetchPlans(): Promise<Plan[]> {
  const { data } = await api.get<PlanResponse[]>('/subscriptions/plans');
  return (data ?? []).map(mapPlan);
}

/** Aduce abonamentul curent al utilizatorului sau `null` dacă nu are unul. */
export async function fetchMySubscription(): Promise<Subscription | null> {
  const { data } = await api.get<SubscriptionResponse | null>('/subscriptions/me');
  return data ? mapSubscription(data) : null;
}

/** Cumpără (activează) un plan și întoarce abonamentul rezultat. */
export async function purchase(plan: string): Promise<Subscription> {
  const { data } = await api.post<SubscriptionResponse>('/subscriptions/purchase', { plan });
  return mapSubscription(data);
}

/** Aduce drepturile deblocate de abonamentul activ. */
export async function fetchEntitlements(): Promise<Entitlements> {
  const { data } = await api.get<EntitlementsResponse>('/subscriptions/entitlements');
  return mapEntitlements(data);
}
