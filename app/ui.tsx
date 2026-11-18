import { CATEGORIES, type CategoryId, type ScanResult } from "@/lib/types";

const color = (n: number) => (n >= 80 ? "var(--pass)" : n >= 50 ? "var(--warn)" : "var(--fail)");

export function ScoreHeader({ r }: { r: Pick<ScanResult, "score" | "grade" | "siteName" | "finalUrl" | "categories"> }) {
  return (
    <div className="card">
      <div className="scorebox">
        <div className="score" style={{ color: color(r.score) }}>{r.score}</div>
        <div>
          <span className={`grade g-${r.grade}`}>Grade {r.grade}</span>
          <div style={{ marginTop: 8, fontWeight: 600 }}>{r.siteName}</div>
          <div className="muted small">{r.finalUrl}</div>
        </div>
      </div>
      <div className="cats">
        {(Object.keys(CATEGORIES) as CategoryId[]).map((id) => (
          <div className="cat" key={id} title={CATEGORIES[id].blurb}>
            <div className="n">{r.categories[id].score}</div>
            <div className="l">{CATEGORIES[id].label}</div>
            <div className="bar"><i style={{ width: `${r.categories[id].score}%`, background: color(r.categories[id].score) }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}
