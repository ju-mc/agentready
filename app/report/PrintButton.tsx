"use client";
export function PrintButton() {
  return <button className="btn accent" style={{ padding: "10px 14px", fontSize: 14 }} onClick={() => window.print()}>Download PDF</button>;
}
