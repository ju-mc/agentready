import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Diagnostic: shows which Stripe mode and Vercel environment this deployment uses. Never reveals the key.
export function GET() {
  const key = process.env.STRIPE_SECRET_KEY || "";
  const stripeMode = !key ? "missing" : key.includes("_live_") ? "live" : key.includes("_test_") ? "test" : "unknown";
  return NextResponse.json({
    stripeMode,
    keyType: key.startsWith("rk_") ? "restricted" : key.startsWith("sk_") ? "standard" : "none",
    vercelEnv: process.env.VERCEL_ENV || "local",
    commit: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7),
  });
}
