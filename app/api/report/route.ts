import { getPaidReport } from "@/lib/payments";
import { reportMarkdown } from "@/lib/markdown";
import { reportPdf } from "@/lib/pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/report?session_id=...&file=md|json|llms|robots|jsonld
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const r = await getPaidReport(q.get("session_id") || undefined, q.get("url") || undefined);
  if (!r) return new Response("Payment required", { status: 402 });
  const host = new URL(r.finalUrl).hostname;
  const files: Record<string, [string, string, string]> = {
    md: [reportMarkdown(r), "text/markdown", `agentscore-${host}.md`],
    json: [JSON.stringify(r, null, 2), "application/json", `agentscore-${host}.json`],
    llms: [r.artifacts?.llmsTxt ?? "", "text/plain", "llms.txt"],
    robots: [r.artifacts?.robotsTxt ?? "", "text/plain", "robots.txt"],
    jsonld: [r.artifacts?.jsonLd ?? "", "text/html", "jsonld-snippet.html"],
  };
  if (q.get("file") === "pdf") {
    const pdf = await reportPdf(r);
    return new Response(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="agentscore-${host}.pdf"` } });
  }
  const f = files[q.get("file") || "md"];
  if (!f) return new Response("Unknown file", { status: 400 });
  return new Response(f[0], { headers: { "content-type": `${f[1]}; charset=utf-8`, "content-disposition": `attachment; filename="${f[2]}"` } });
}
