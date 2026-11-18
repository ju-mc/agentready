import { NextResponse } from "next/server";
import { scan, toFree } from "@/lib/scanner";

export const runtime = "nodejs";
export const maxDuration = 60;

// Best-effort per-instance rate limit: 10 scans / IP / 10 min.
const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 10 * 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 10;
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  if (limited(ip)) return NextResponse.json({ error: "Too many scans. Try again in a few minutes." }, { status: 429 });
  const { url } = await req.json().catch(() => ({}));
  if (!url || typeof url !== "string" || url.length > 2000) return NextResponse.json({ error: "Enter a website URL." }, { status: 400 });
  try {
    // Free tier only ever returns the summary; details/fixes never leave the server.
    return NextResponse.json(toFree(await scan(url)));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Scan failed" }, { status: 422 });
  }
}
