import { getPaidReport } from "@/lib/payments";
import { CATEGORIES, type CategoryId } from "@/lib/types";
import { ScoreHeader } from "../ui";
import { PrintButton } from "./PrintButton";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export default async function ReportPage({ searchParams }: { searchParams: Promise<{ session_id?: string; url?: string }> }) {
  const { session_id, url } = await searchParams;
  let r: Awaited<ReturnType<typeof getPaidReport>> = null;
  let err = "";
  try {
    r = await getPaidReport(session_id, url);
  } catch (e) {
    err = e instanceof Error ? e.message : "Something went wrong";
  }

  if (!r) {
    return (
      <main className="wrap">
        <h1>Report not available</h1>
        <p className="lede">{err || "We couldn't confirm a payment for this report. If you were charged, email us and we'll send it."}</p>
        <a className="btn" href="/">Run a free scan</a>
      </main>
    );
  }

  const q = session_id ? `session_id=${encodeURIComponent(session_id)}` : `url=${encodeURIComponent(url!)}`;
  const dl = (file: string) => `/api/report?${q}&file=${file}`;
  const fixes = r.checks.filter((c) => c.fix && (c.status === "fail" || c.status === "warn")).sort((a, b) => (b.max - b.earned) - (a.max - a.earned));

  return (
    <main className="wrap">
      <h1>Agent readiness report</h1>
      <p className="muted small">Scanned {new Date(r.scannedAt).toUTCString()}</p>
      <div className="fix noprint" style={{ marginBottom: 12 }}>
        <strong>Save your report:</strong> bookmark this page or download a copy below. This link is your access to the report.
      </div>
      <div className="row noprint" style={{ marginBottom: 8 }}>
        <PrintButton />
        <a className="btn secondary" href={dl("md")}>Download Markdown</a>
        <a className="btn secondary" href={dl("json")}>Raw JSON</a>
      </div>

      <ScoreHeader r={r} />

      {fixes.length > 0 && (
        <>
          <h2>Priority fixes</h2>
          <div className="card">
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              {fixes.map((c) => (
                <li key={c.id} style={{ marginBottom: 10 }}>
                  <strong>{c.title}</strong> <span className="muted small">(+{c.max - c.earned} pts)</span>
                  <div className="small">{c.fix}</div>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}

      {(Object.keys(CATEGORIES) as CategoryId[]).map((id) => (
        <section key={id}>
          <h2>{CATEGORIES[id].label}: {r.categories[id].score}/100</h2>
          <p className="muted small" style={{ marginTop: -6 }}>{CATEGORIES[id].blurb}</p>
          {r.checks.filter((c) => c.category === id).map((c) => (
            <div className="card" key={c.id}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div className="row"><span className={`dot s-${c.status}`} style={{ marginTop: 0 }} /><h3>{c.title}</h3></div>
                <span className="muted small">{c.earned}/{c.max}</span>
              </div>
              <p style={{ margin: "8px 0 0" }}>{c.summary}</p>
              {c.detail && <p className="muted small">{c.detail}</p>}
              {c.evidence?.length ? <details><summary>Evidence</summary><pre>{c.evidence.join("\n")}</pre></details> : null}
              {c.fix && <div className="fix"><strong>Fix:</strong> {c.fix}</div>}
            </div>
          ))}
        </section>
      ))}

      {r.pages?.length ? (
        <>
          <h2>Page sample</h2>
          <div className="card" style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th>Page</th><th>HTTP</th><th>Words w/o JS</th><th>H1</th><th>Description</th><th>JSON-LD</th><th>Unlabeled</th></tr></thead>
              <tbody>
                {r.pages.map((p) => (
                  <tr key={p.url}>
                    <td className="url">{p.url}</td><td>{p.status}</td>
                    <td style={{ color: p.words < 50 ? "var(--fail)" : undefined }}>{p.words}</td>
                    <td>{p.hasH1 ? "✓" : "✗"}</td><td>{p.hasDescription ? "✓" : "✗"}</td>
                    <td>{p.jsonLdTypes.join(", ") || "—"}</td><td>{p.unlabeledControls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {r.artifacts && (
        <>
          <h2>Ready-to-use files</h2>
          {([
            ["llms.txt", "Save at your site root as /llms.txt. Edit the descriptions to taste.", r.artifacts.llmsTxt, "llms"],
            ["robots.txt", "Merge with your existing robots.txt rules.", r.artifacts.robotsTxt, "robots"],
            ["JSON-LD starter", "Paste into the <head> of your homepage. Fill in sameAs with your social profiles.", r.artifacts.jsonLd, "jsonld"],
          ] as const).map(([name, note, body, file]) => (
            <div className="card" key={name}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h3>{name}</h3>
                <a className="btn secondary noprint" href={dl(file)}>Download</a>
              </div>
              <p className="muted small">{note}</p>
              <pre>{body}</pre>
            </div>
          ))}
        </>
      )}
    </main>
  );
}
