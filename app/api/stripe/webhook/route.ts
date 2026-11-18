import { after } from "next/server";
import type Stripe from "stripe";
import { stripe, isPaid, cachedFullScan } from "@/lib/payments";
import { sendReportEmail } from "@/lib/email";

export const runtime = "nodejs";
export const maxDuration = 60;

// Stripe → checkout.session.completed (+ async_payment_succeeded): email the buyer their report.
export async function POST(req: Request) {
  const s = stripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!s || !secret) return new Response("Webhook not configured", { status: 500 });

  let event: Stripe.Event;
  try {
    event = s.webhooks.constructEvent(await req.text(), req.headers.get("stripe-signature") || "", secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
    return new Response("ignored");
  }
  const session = event.data.object as Stripe.Checkout.Session;
  const email = session.customer_details?.email;
  const url = session.metadata?.url;
  if (!isPaid(session) || !email || !url) return new Response("nothing to send");

  const base = process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin;
  const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;

  // Respond to Stripe right away; do the scan + email after the response is sent.
  after(async () => {
    try {
      // Idempotency: Stripe can deliver the same event more than once.
      if (piId) {
        const pi = await s.paymentIntents.retrieve(piId);
        if (pi.metadata?.report_email) return;
        await s.paymentIntents.update(piId, { metadata: { report_email: "sending" } });
      }
      const result = await cachedFullScan(`s:${session.id}`, url);
      await sendReportEmail(email, result, `${base}/report?session_id=${session.id}`);
      if (piId) await s.paymentIntents.update(piId, { metadata: { report_email: `sent ${new Date().toISOString()}` } });
    } catch (e) {
      console.error("[report-email] failed for", session.id, e);
      // Clear the flag so resending the event from the Stripe dashboard can try again.
      if (piId) await s.paymentIntents.update(piId, { metadata: { report_email: "" } }).catch(() => {});
    }
  });

  return new Response("ok");
}
