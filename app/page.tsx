"use client";

import { useEffect, useState } from "react";
import type { FreeScanResult } from "@/lib/types";
import { ScoreHeader } from "./ui";

const PRICE = process.env.NEXT_PUBLIC_PRICE_LABEL || "$9";

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<FreeScanResult | null>(null);

  useEffect(() => {
    const u = new URLSearchParams(window.location.search).get("url");
    if (u) { setUrl(u); runScan(u); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runScan(target = url) {
    setLoading(true); setError(""); setResult(null);
    try {
      const res = await fetch("/api/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: target }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setLoading(false);
    }
  }

  async function unlock() {
    if (!result) return;
    setPaying(true);
    try {
      const res = await fetch("/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: result.finalUrl }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      window.location.href = data.checkoutUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed");
      setPaying(false);
    }
  }

  return (
    <main className="wrap">
      <h1>Is your website ready for AI agents?</h1>
      <p className="lede">ChatGPT, Claude and Perplexity now browse, compare and buy on people&apos;s behalf. Free check: can they reach your site, read it, and use it?</p>

      <form className="scan" onSubmit={(e) => { e.preventDefault(); runScan(); }}>
        <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="yourwebsite.com" aria-label="Website URL" />
        <button disabled={loading || !url.trim()}>{loading ? "Scanning…" : "Scan free"}</button>
      </form>
      {loading && <p className="muted small">Checking robots.txt, bot firewalls, rendering, structured data and more. Takes 5–15 seconds.</p>}
      {error && <p className="error">{error}</p>}

      {result && (
        <>
          <ScoreHeader r={result} />

          <div className="card">
            <h3>{result.counts.fail} failing · {result.counts.warn} warnings · {result.counts.pass} passing</h3>
            <div style={{ marginTop: 8 }}>
              {result.topIssues.length === 0 && <p className="muted">No issues found. Nice.</p>}
              {result.topIssues.map((i) => (
                <div className="issue" key={i.title}>
                  <span className={`dot s-${i.status}`} />
                  <div><strong>{i.title}</strong><div className="muted small">{i.summary}</div></div>
                </div>
              ))}
              {Array.from({ length: Math.min(result.lockedIssues, 3) }).map((_, k) => (
                <div className="issue locked" key={k} aria-hidden>
                  <span className="dot s-warn" />
                  <div><strong>Hidden issue title goes here</strong><div className="muted small">Unlock the full report to see this result and how to fix it.</div></div>
                </div>
              ))}
            </div>
          </div>

          <div className="card paywall">
            <h2 style={{ marginTop: 0 }}>Get the full report: {PRICE}</h2>
            <p className="muted">
              {result.lockedIssues > 0 ? `${result.lockedIssues} more issue${result.lockedIssues === 1 ? "" : "s"}, plus ` : ""}
              a step-by-step fix for every check, a 10-page sample of your site, and ready-to-paste <code>llms.txt</code>, <code>robots.txt</code> and JSON-LD files. Download as PDF or Markdown.
            </p>
            <button className="btn accent" onClick={unlock} disabled={paying}>{paying ? "Opening checkout…" : `Unlock full report: ${PRICE}`}</button>
          </div>
        </>
      )}

      {!result && !loading && (
        <div className="card small muted">
          <strong style={{ color: "var(--fg)" }}>What we check:</strong> AI bots blocked by your firewall or robots.txt · content invisible without JavaScript · llms.txt and sitemaps · schema.org structured data · unlabeled buttons and forms that browser agents can&apos;t operate · API and agent manifests.
        </div>
      )}
    </main>
  );
}
