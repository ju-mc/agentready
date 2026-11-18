"use client";
export function PrintButton() {
  return <button className="btn secondary" onClick={() => window.print()}>Download PDF</button>;
}
