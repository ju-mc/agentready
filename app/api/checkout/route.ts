import { NextResponse } from "next/server";
import { stripe, PRICE_CENTS, devUnlock } from "@/lib/payments";
import { normalizeInputUrl } from "@/lib/fetcher";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { url } = await req.json().catch(() => ({}));
  let target: URL;
  try { target = normalizeInputUrl(String(url || "")); } catch { return NextResponse.json({ error: "Invalid URL" }, { status: 400 }); }
  const base = process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin;

  const s = stripe();
  if (!s) {
    if (devUnlock()) return NextResponse.json({ checkoutUrl: `${base}/report?url=${encodeURIComponent(target.toString())}` });
    return NextResponse.json({ error: "Payments aren't configured yet." }, { status: 503 });
  }
  const session = await s.checkout.sessions.create({
    mode: "payment",
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: PRICE_CENTS,
        product_data: { name: `AgentScore full report: ${target.hostname}`, description: "Every check explained, fixes, page-by-page results, and ready-to-paste llms.txt, robots.txt and JSON-LD." },
      },
    }],
    metadata: { url: target.toString() },
    allow_promotion_codes: true,
    success_url: `${base}/report?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/?url=${encodeURIComponent(target.toString())}`,
  });
  return NextResponse.json({ checkoutUrl: session.url });
}
