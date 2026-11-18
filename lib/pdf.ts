import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { CATEGORIES, type CategoryId, type ScanResult, type Status } from "./types";

// Standard PDF fonts only cover WinAnsi; replace anything else so generation never throws.
const WINANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
function clean(s: string): string {
  return Array.from(s.replace(/\r/g, "").replace(/\t/g, "  "))
    .map((ch) => {
      const c = ch.codePointAt(0)!;
      if (ch === "\n" || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.includes(ch)) return ch;
      if (ch === "→") return "->";
      if (ch === "✓" || ch === "✅") return "[ok]";
      if (ch === "✗" || ch === "❌") return "[x]";
      return "";
    })
    .join("");
}

const COLORS: Record<Status, ReturnType<typeof rgb>> = {
  pass: rgb(0.12, 0.54, 0.3),
  warn: rgb(0.72, 0.47, 0.12),
  fail: rgb(0.77, 0.19, 0.19),
  info: rgb(0.29, 0.33, 0.41),
};
const LABEL: Record<Status, string> = { pass: "PASS", warn: "WARN", fail: "FAIL", info: "INFO" };

class Writer {
  page!: PDFPage;
  y = 0;
  readonly W = 612;
  readonly H = 792;
  readonly M = 54;
  constructor(private doc: PDFDocument, private font: PDFFont, private bold: PDFFont, private mono: PDFFont) {
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage([this.W, this.H]);
    this.y = this.H - this.M;
  }
  ensure(h: number) {
    if (this.y - h < this.M) this.newPage();
  }
  wrap(text: string, f: PDFFont, size: number, width: number): string[] {
    const out: string[] = [];
    for (const para of clean(text).split("\n")) {
      let line = "";
      for (const word of para.split(" ")) {
        const test = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(test, size) <= width) { line = test; continue; }
        if (line) out.push(line);
        // hard-break very long tokens (URLs)
        let w = word;
        while (f.widthOfTextAtSize(w, size) > width) {
          let i = w.length;
          while (i > 1 && f.widthOfTextAtSize(w.slice(0, i), size) > width) i--;
          out.push(w.slice(0, i));
          w = w.slice(i);
        }
        line = w;
      }
      out.push(line);
    }
    return out;
  }
  text(t: string, opts: { size?: number; bold?: boolean; mono?: boolean; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const f = opts.mono ? this.mono : opts.bold ? this.bold : this.font;
    const x = this.M + (opts.indent ?? 0);
    const lh = size * 1.4;
    for (const line of this.wrap(t, f, size, this.W - this.M - x)) {
      this.ensure(lh);
      this.page.drawText(line, { x, y: this.y - size, size, font: f, color: opts.color ?? rgb(0.09, 0.09, 0.1) });
      this.y -= lh;
    }
    this.y -= opts.gap ?? 4;
  }
  rule() {
    this.ensure(10);
    this.page.drawLine({ start: { x: this.M, y: this.y }, end: { x: this.W - this.M, y: this.y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.82) });
    this.y -= 10;
  }
}

export async function reportPdf(r: ScanResult): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`AgentScore report: ${r.siteName}`);
  doc.setAuthor("AgentScore");
  const w = new Writer(
    doc,
    await doc.embedFont(StandardFonts.Helvetica),
    await doc.embedFont(StandardFonts.HelveticaBold),
    await doc.embedFont(StandardFonts.Courier)
  );
  const muted = rgb(0.42, 0.42, 0.46);

  w.text("AgentScore report", { size: 22, bold: true });
  w.text(`${r.siteName} · ${r.finalUrl}`, { color: muted });
  w.text(`Scanned ${new Date(r.scannedAt).toUTCString()}`, { color: muted, gap: 12 });
  w.text(`Score: ${r.score}/100  (Grade ${r.grade})`, { size: 18, bold: true, color: r.score >= 80 ? COLORS.pass : r.score >= 50 ? COLORS.warn : COLORS.fail });
  for (const id of Object.keys(CATEGORIES) as CategoryId[]) w.text(`${CATEGORIES[id].label}: ${r.categories[id].score}/100`, { indent: 8, gap: 0 });
  w.y -= 8;

  const fixes = r.checks.filter((c) => c.fix && (c.status === "fail" || c.status === "warn")).sort((a, b) => (b.max - b.earned) - (a.max - a.earned));
  if (fixes.length) {
    w.rule();
    w.text("Priority fixes", { size: 15, bold: true });
    fixes.forEach((c, i) => {
      w.text(`${i + 1}. ${c.title} (+${c.max - c.earned} pts)`, { bold: true, gap: 0 });
      w.text(c.fix!, { indent: 14 });
    });
  }

  for (const id of Object.keys(CATEGORIES) as CategoryId[]) {
    w.rule();
    w.text(`${CATEGORIES[id].label}: ${r.categories[id].score}/100`, { size: 15, bold: true, gap: 0 });
    w.text(CATEGORIES[id].blurb, { color: muted, gap: 8 });
    for (const c of r.checks.filter((c) => c.category === id)) {
      w.ensure(40);
      w.text(`[${LABEL[c.status]}] ${c.title}  (${c.earned}/${c.max})`, { bold: true, color: COLORS[c.status], gap: 1 });
      w.text(c.summary, { indent: 8, gap: 2 });
      if (c.detail) w.text(c.detail, { indent: 8, size: 9, color: muted, gap: 2 });
      if (c.evidence?.length) w.text(c.evidence.join("\n"), { indent: 8, size: 8, mono: true, gap: 2 });
      if (c.fix) w.text(`Fix: ${c.fix}`, { indent: 8, gap: 2 });
      w.y -= 6;
    }
  }

  if (r.pages?.length) {
    w.rule();
    w.text("Page-by-page results", { size: 15, bold: true });
    for (const p of r.pages) {
      w.text(p.url, { bold: true, size: 9, gap: 0 });
      w.text(
        `HTTP ${p.status} · ${p.words} words without JS · H1: ${p.hasH1 ? "yes" : "no"} · description: ${p.hasDescription ? "yes" : "no"} · JSON-LD: ${p.jsonLdTypes.join(", ") || "none"} · unlabeled controls: ${p.unlabeledControls}`,
        { indent: 8, size: 9, color: muted }
      );
    }
  }

  if (r.artifacts) {
    for (const [name, body] of [["llms.txt (save at your site root)", r.artifacts.llmsTxt], ["robots.txt (suggested)", r.artifacts.robotsTxt], ["JSON-LD starter (paste into <head>)", r.artifacts.jsonLd]] as const) {
      w.rule();
      w.text(name, { size: 13, bold: true });
      w.text(body, { mono: true, size: 8 });
    }
  }

  // page numbers
  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  pages.forEach((p, i) => p.drawText(`AgentScore · checkagentscore.com · ${i + 1}/${pages.length}`, { x: 54, y: 28, size: 8, font, color: muted }));
  return doc.save();
}
