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

/**
 * Resolves a paid report. Returns null if the session isn't paid.
 * Dev mode: pass `devUrl` with DEV_UNLOCK=1 to skip Stripe.
 */
export async function getPaidReport(sessionId?: string, devUrl?: string): Promise<ScanResult | null> {
  let url: string | undefined;
  let key: string;

  if (sessionId) {
    const s = stripe();
    if (!s) return null;
    const session = await s.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") return null;
    url = session.metadata?.url;
    key = `s:${sessionId}`;
  } else if (devUrl && devUnlock()) {
    url = devUrl;
    key = `d:${devUrl}`;
  } else return null;

  if (!url) return null;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.result;
  const result = await scan(url, { full: true });
  cache.set(key, { at: Date.now(), result });
  return result;
}
