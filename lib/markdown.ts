import { CATEGORIES, type CategoryId, type ScanResult } from "./types";

const ICON = { pass: "✅", warn: "⚠️", fail: "❌", info: "ℹ️" } as const;

export function reportMarkdown(r: ScanResult): string {
  const L: string[] = [];
  L.push(`# Agent Readiness Report: ${r.siteName}`, "");
  L.push(`**URL:** ${r.finalUrl}  `, `**Scanned:** ${new Date(r.scannedAt).toUTCString()}  `, `**Score:** ${r.score}/100 (Grade ${r.grade})`, "");
  L.push("| Category | Score |", "|---|---|");
  for (const id of Object.keys(CATEGORIES) as CategoryId[]) L.push(`| ${CATEGORIES[id].label} | ${r.categories[id].score}/100 |`);
  L.push("");

  const fixes = r.checks.filter((c) => c.fix && (c.status === "fail" || c.status === "warn"));
  if (fixes.length) {
    L.push("## Priority fixes", "");
    fixes
      .sort((a, b) => (b.max - b.earned) - (a.max - a.earned))
      .forEach((c, i) => L.push(`${i + 1}. **${c.title}** (+${c.max - c.earned} pts): ${c.fix}`));
    L.push("");
  }

  for (const id of Object.keys(CATEGORIES) as CategoryId[]) {
    L.push(`## ${CATEGORIES[id].label} (${r.categories[id].score}/100)`, "", `_${CATEGORIES[id].blurb}_`, "");
    for (const c of r.checks.filter((c) => c.category === id)) {
      L.push(`### ${ICON[c.status]} ${c.title} (${c.earned}/${c.max})`, "", c.summary, "");
      if (c.detail) L.push(c.detail, "");
      if (c.evidence?.length) L.push("```", ...c.evidence, "```", "");
      if (c.fix) L.push(`**Fix:** ${c.fix}`, "");
    }
  }

  if (r.pages?.length) {
    L.push("## Page sample", "", "| Page | HTTP | Words (no JS) | H1 | Description | JSON-LD | Unlabeled controls |", "|---|---|---|---|---|---|---|");
    for (const p of r.pages)
      L.push(`| ${p.url} | ${p.status} | ${p.words} | ${p.hasH1 ? "yes" : "no"} | ${p.hasDescription ? "yes" : "no"} | ${p.jsonLdTypes.join(", ") || "none"} | ${p.unlabeledControls} |`);
    L.push("");
  }

  if (r.artifacts) {
    L.push("## Ready-to-use files", "");
    L.push("### llms.txt (save at your site root)", "", "```markdown", r.artifacts.llmsTxt, "```", "");
    L.push("### robots.txt (suggested)", "", "```", r.artifacts.robotsTxt, "```", "");
    L.push("### JSON-LD starter (paste into <head>)", "", "```html", r.artifacts.jsonLd, "```", "");
  }
  return L.join("\n");
}
