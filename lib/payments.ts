import Stripe from "stripe";
import { scan } from "./scanner";
import type { ScanResult } from "./types";

export const PRICE_CENTS = Number(process.env.REPORT_PRICE_CENTS || 900);

export function stripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? new Stripe(key) : null;
}

export function devUnlock(): boolean {
  return process.env.DEV_UNLOCK === "1" && process.env.NODE_ENV !== "production";
}

// Best-effort cache so reloading / downloading doesn't rescan. Per server instance only.
const cache = new Map<string, { at: number; result: ScanResult }>();
const TTL = 60 * 60 * 1000;

export function isPaid(session: Stripe.Checkout.Session): boolean {
  // "no_payment_required" = a 100%-off promo code was used (e.g. internal testing)
  return session.payment_status === "paid" || session.payment_status === "no_payment_required";
}

/** Full scan with a per-instance cache so reloads / downloads / the email don't each rescan. */
export async function cachedFullScan(key: string, url: string): Promise<ScanResult> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.result;
  const result = await scan(url, { full: true });
  cache.set(key, { at: Date.now(), result });
  return result;
}

/**
 * Resolves a paid report plus the buyer's checkout email. Returns null if the session isn't paid.
 * Dev mode: pass `devUrl` with DEV_UNLOCK=1 to skip Stripe.
 */
export async function getPaidReportWithEmail(sessionId?: string, devUrl?: string): Promise<{ result: ScanResult; email: string | null } | null> {
  if (sessionId) {
    const s = stripe();
    if (!s) return null;
    const session = await s.checkout.sessions.retrieve(sessionId);
    if (!isPaid(session) || !session.metadata?.url) return null;
    const result = await cachedFullScan(`s:${sessionId}`, session.metadata.url);
    return { result, email: session.customer_details?.email ?? null };
  }
  if (devUrl && devUnlock()) return { result: await cachedFullScan(`d:${devUrl}`, devUrl), email: null };
  return null;
}

export async function getPaidReport(sessionId?: string, devUrl?: string): Promise<ScanResult | null> {
  return (await getPaidReportWithEmail(sessionId, devUrl))?.result ?? null;
}
